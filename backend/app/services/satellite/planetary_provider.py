"""Sentinel-2 retrieval via STAC API (supports both AWS Earth Search and
Microsoft Planetary Computer).

AWS Earth Search: https://earth-search.aws.element84.com/v1
  - No signing required (public S3 bucket)
  - Asset keys: data_B02, data_B03, ..., data_B08, data_B11
  - Collection: sentinel-2-l2a

Microsoft Planetary Computer: https://planetarycomputer.microsoft.com/api/stac/v1
  - Requires planetary_computer.sign() for authenticated URLs
  - Asset keys: B02, B03, ..., B08, B11
  - Collection: sentinel-2-l2a

This provider auto-detects which STAC backend is configured and adapts
its band-key mapping and signing logic accordingly.

**Timeout & fallback:** All network calls use strict timeouts. If the
STAC API or band download fails or times out, the provider raises a
``SatelliteError`` so the pipeline can fall back to the sample provider.
"""

from __future__ import annotations

import time as _time
from datetime import date, datetime
from typing import Any

import numpy as np

try:
    import rasterio
    from pystac_client import Client
    from rasterio.mask import mask as rio_mask
    from rasterio.warp import transform_geom
except Exception:
    Client = None
    rasterio = None
    rio_mask = None
    transform_geom = None

# Optional — only needed when using Microsoft Planetary Computer.
try:
    import planetary_computer
except Exception:
    planetary_computer = None

from app.core.logging import get_logger
from app.services.satellite.base import (
    BandStack,
    ImageryBundle,
    SatelliteError,
    SceneNotFoundError,
)

LOGGER = get_logger(__name__)

# Sentinel-2 L2A band keys — different per STAC backend.
# AWS Earth Search uses "data_B02" style keys, Planetary Computer uses "B02".
BAND_KEYS_EARTH_SEARCH = {
    "blue": "blue",
    "green": "green",
    "red": "red",
    "red_edge": "rededge1",
    "nir": "nir",
    "swir": "swir16",
}

BAND_KEYS_PLANETARY = {
    "blue": "B02",
    "green": "B03",
    "red": "B04",
    "red_edge": "B05",
    "nir": "B08",
    "swir": "B11",
}

# Sentinel-2 L2A surface reflectance scale factor.
REFLECTANCE_SCALE = 10_000.0

# Timeout for the STAC API search call (seconds).
_STAC_SEARCH_TIMEOUT = 20

# Timeout for signing a STAC item (seconds).
_STAC_SIGN_TIMEOUT = 15

# Timeout for downloading a single band (seconds).
_BAND_DOWNLOAD_TIMEOUT = 30

# Maximum total time for the entire fetch operation (seconds).
_FETCH_TOTAL_TIMEOUT = 90

# AWS Earth Search base URL.
EARTH_SEARCH_URL = "earth-search.aws.element84.com"
PLANETARY_URL = "planetarycomputer.microsoft.com"


def _is_earth_search(stac_url: str) -> bool:
    """Return True if the configured STAC URL is AWS Earth Search."""
    return EARTH_SEARCH_URL in stac_url


class PlanetaryComputerProvider:
    """Real Sentinel-2 imagery via STAC API (Earth Search or Planetary Computer)."""

    def __init__(self, stac_url: str) -> None:
        self._stac_url = stac_url
        self._client: Client | None = None
        self._use_earth_search = _is_earth_search(stac_url)
        self._band_keys = BAND_KEYS_EARTH_SEARCH if self._use_earth_search else BAND_KEYS_PLANETARY
        self.name = "aws-earth-search" if self._use_earth_search else "microsoft-planetary-computer"

    def _client_lazy(self) -> Client:
        if self._client is None:
            LOGGER.info(
                "Opening STAC client: %s (backend=%s)",
                self._stac_url,
                "aws-earth-search" if self._use_earth_search else "planetary-computer",
            )
            self._client = Client.open(self._stac_url)
        return self._client

    def _sign_item(self, item: Any) -> Any:
        """Sign the STAC item if needed (only for Planetary Computer)."""
        if self._use_earth_search:
            # AWS Earth Search: no signing needed, assets are public S3 URLs
            return item
        if planetary_computer is None:
            raise SatelliteError("planetary_computer is not installed")
        return planetary_computer.sign(item)

    def fetch(
        self,
        *,
        geometry: dict[str, Any],
        start_date: date,
        end_date: date,
        max_cloud_cover: float,
    ) -> ImageryBundle:
        if Client is None:
            raise SatelliteError("pystac_client is not installed — cannot reach STAC API")

        fetch_start = _time.monotonic()
        date_range = f"{start_date.isoformat()}/{end_date.isoformat()}"
        backend_name = "AWS Earth Search" if self._use_earth_search else "Planetary Computer"
        LOGGER.info(
            "%s search: collection=sentinel-2-l2a window=%s cloud<%.1f",
            backend_name,
            date_range,
            max_cloud_cover,
        )

        try:
            client = self._client_lazy()
            search = client.search(
                collections=["sentinel-2-l2a"],
                intersects=geometry,
                datetime=date_range,
                query={"eo:cloud_cover": {"lt": max_cloud_cover}},
                sortby=[{"field": "properties.datetime", "direction": "desc"}],
                limit=10,
            )

            items = _search_with_timeout(search, _STAC_SEARCH_TIMEOUT)

        except Exception as exc:
            elapsed = _time.monotonic() - fetch_start
            raise SatelliteError(
                f"{backend_name} STAC search failed after {elapsed:.1f}s: "
                f"{type(exc).__name__}: {exc}"
            ) from exc

        if not items:
            raise SceneNotFoundError(
                f"No Sentinel-2 L2A scene with cloud<{max_cloud_cover}% intersects the AOI "
                f"in {date_range}."
            )

        # If we've already spent too much time, bail out early.
        elapsed = _time.monotonic() - fetch_start
        if elapsed > _FETCH_TOTAL_TIMEOUT * 0.7:
            raise SatelliteError(
                f"STAC search took {elapsed:.1f}s — too slow, skipping band download"
            )

        item = items[0]

        # Sign the item (only needed for Planetary Computer).
        try:
            signed = self._sign_item(item)
        except Exception as exc:
            elapsed = _time.monotonic() - fetch_start
            raise SatelliteError(
                f"STAC signing failed after {elapsed:.1f}s: {type(exc).__name__}: {exc}"
            ) from exc

        LOGGER.info(
            "Selected scene id=%s captured=%s cloud=%.2f (backend=%s)",
            signed.id,
            signed.datetime,
            signed.properties.get("eo:cloud_cover", float("nan")),
            backend_name,
        )

        try:
            stack = _read_bands(signed, geometry, self._band_keys)
        except Exception as exc:
            elapsed = _time.monotonic() - fetch_start
            raise SatelliteError(
                f"failed to read scene bands after {elapsed:.1f}s: {type(exc).__name__}: {exc}"
            ) from exc

        capture_dt: datetime = signed.datetime or datetime.fromisoformat(
            signed.properties["datetime"].replace("Z", "+00:00")
        )

        total_elapsed = _time.monotonic() - fetch_start
        LOGGER.info(
            "Imagery fetch completed in %.1fs: scene=%s backend=%s",
            total_elapsed,
            signed.id,
            backend_name,
        )

        return ImageryBundle(
            bands=stack,
            scene_id=signed.id,
            capture_date=capture_dt,
            cloud_cover=float(signed.properties.get("eo:cloud_cover", 0.0)),
            provider=self.name,
            thumbnail_url=(
                signed.assets["thumbnail"].href
                if "thumbnail" in signed.assets
                else signed.assets.get("rendered_preview", {}).href
            ),
            metadata={
                "platform": signed.properties.get("platform"),
                "instruments": signed.properties.get("instruments"),
                "mgrs_tile": signed.properties.get("s2:mgrs_tile"),
                "datetime": capture_dt.isoformat(),
                "stac_id": signed.id,
                "stac_backend": backend_name,
                "fetch_duration_seconds": round(total_elapsed, 1),
            },
        )


def _search_with_timeout(search, timeout: float):
    """Collect search results with a wall-clock timeout."""
    deadline = _time.monotonic() + timeout
    items = []
    for item in search.items():
        if _time.monotonic() > deadline:
            LOGGER.warning(
                "STAC search timed out after %.1fs — using %d items so far",
                timeout,
                len(items),
            )
            break
        items.append(item)
    return items


def _read_bands(
    item: Any,
    geometry: dict[str, Any],
    band_keys: dict[str, str],
) -> BandStack:
    """Read each Sentinel-2 band, clip to the AOI, resample to a common grid.

    Sentinel-2 bands have mixed native resolutions: B02/B03/B04/B08 are
    10 m and B05/B11 are 20 m, so a clip can return arrays of two different
    shapes. We align them before any element-wise combine.
    """
    if rasterio is None:
        raise SatelliteError("rasterio is not installed")

    band_start = _time.monotonic()
    raw: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    for friendly, asset_key in band_keys.items():
        if asset_key not in item.assets:
            LOGGER.warning("Asset %s not found in scene; skipping band %s", asset_key, friendly)
            continue

        href = item.assets[asset_key].href
        remaining = _BAND_DOWNLOAD_TIMEOUT - (_time.monotonic() - band_start)
        if remaining <= 0:
            raise SatelliteError(f"Band download timed out after reading {len(raw)} bands")

        with rasterio.open(href) as src:
            geom_in_band_crs = transform_geom("EPSG:4326", src.crs, geometry)
            clipped, _transform = rio_mask(
                src,
                [geom_in_band_crs],
                crop=True,
                indexes=1,
                filled=False,
            )
            data = np.asarray(clipped, dtype=np.float32) / REFLECTANCE_SCALE
            mask = (
                np.ma.getmaskarray(clipped)
                if np.ma.isMaskedArray(clipped)
                else np.zeros(data.shape, dtype=bool)
            )
            raw[friendly] = (data, mask)

    if not raw:
        raise SatelliteError("no bands could be read")

    # Pick the highest-resolution grid available — usually the 10 m bands.
    target_shape = max((d.shape for d, _ in raw.values()), key=lambda s: s[0] * s[1])

    aligned: dict[str, np.ndarray] = {}
    masks: dict[str, np.ndarray] = {}
    for friendly, (data, mask) in raw.items():
        if data.shape != target_shape:
            data = _resize_nearest(data, target_shape)
            mask = _resize_nearest(mask, target_shape)
        aligned[friendly] = np.where(mask, np.nan, data)
        masks[friendly] = mask

    valid_mask = np.ones(target_shape, dtype=bool)
    for friendly, mask in masks.items():
        valid_mask = valid_mask & (~mask) & np.isfinite(aligned[friendly])

    return BandStack(
        blue=aligned.get("blue"),
        green=aligned.get("green"),
        red=aligned.get("red"),
        red_edge=aligned.get("red_edge"),
        nir=aligned.get("nir"),
        swir=aligned.get("swir"),
        valid_mask=valid_mask,
    )


def _resize_nearest(arr: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Cheap nearest-neighbour resample that preserves dtype (incl. bool)."""
    rows, cols = shape
    src_rows, src_cols = arr.shape
    row_idx = np.linspace(0, src_rows - 1, rows).astype(int)
    col_idx = np.linspace(0, src_cols - 1, cols).astype(int)
    return arr[np.ix_(row_idx, col_idx)]
