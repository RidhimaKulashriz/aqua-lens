# DRIFT Verification Notes

## Browser-verified simulator flow

On 2026-08-25, the live development preview was opened in a browser and the **Run Demo** control was executed without hardware configured. The app completed the simulator run and the dashboard refreshed with a persisted completed mission, twelve telemetry waypoints, three persisted findings, updated repair exposure, and a ready report record.

The verified fallback state displayed the hardware adapter as offline and kept simulator mode available, matching the platform’s safety boundary: it does not arm, launch, or control aircraft.

## Browser-verified operational workspaces

The persisted simulator findings were opened in the **Defect control** workspace, where severity filters and per-finding review controls were visible for the critical structural, high crack, and medium pothole findings. The **Reports** workspace displayed the generated ready-state ZeroError inspection report for the completed demo corridor patrol.

## Post-alert persistence validation

After extending the simulator to create alerts and simulated evidence, a fresh browser run was initiated from the **Run Demo** control against the updated backend. The next validation step checks the completed mission records, alert strip, and Evidence Vault output.

The completed run created a second persisted demo mission with six accumulated findings, two open maintenance alerts, and updated repair exposure. The dashboard visibly surfaced the alert strip and Evidence Vault after the run, confirming the simulator’s persisted alert and no-hardware inspection-data workflow. Evidence cards were available for review in the vault; the UI retains a clear upload control for authenticated mission-media additions.

## Authenticated-control boundary

The personal browser opened the completed project and successfully reached the report workspace. Selecting the protected AI narrative control redirected to the application sign-in page, confirming that this decision-support operation is gated by the configured authentication boundary rather than being exposed anonymously. Public simulator, alert, report listing, and evidence-review flows remain usable without a drone or user session.

## Relationship-integrity correction

Final database inspection exposed an insert-result shape issue that caused earlier generated demo rows to retain `0` relationship identifiers. The MySQL insert-ID helper was corrected to read the returned result header, and the internally generated pre-fix demo rows were removed. Final simulator validation proceeds from an empty dataset to confirm correct mission-to-asset, defect, alert, evidence, and report relationships.

The clean browser run completed successfully after the correction, showing one completed demo mission, three findings, two maintenance alerts, and the expected repair exposure. The next read-only database validation checks that these records share the same non-zero mission and asset identifiers.

## Evidence Vault access validation

In the newly selected browser session, the Evidence Vault rendered its simulator evidence-review experience and uploaded-media control. The database validation separately confirms three persisted evidence records linked to the clean simulator mission. Secure original-file retrieval remains intentionally authentication-gated; without an authenticated application session, the vault presents the safe simulator review fallback rather than exposing storage originals.

After adding the safe demo-evidence retrieval path, the browser-confirmed Evidence Vault displayed the three persisted annotation records directly: `BRIDGE-STRUCTURAL-FRAME.SVG`, `EASTBOUND-CRACK-PASS.SVG`, and `SERVICE-LANE-POTHOLE.SVG`, with their stored GPS coordinates and simulated-evidence links. This verifies the no-hardware evidence lifecycle end to end without exposing authenticated uploaded originals.

## Role workspace validation

The browser opened the clearly labeled **Demo Preview · Engineer** workspace, which provides the operational-review presentation. Switching to **Demo Preview · Citizen** rendered the public-status desk with the corresponding read-only explanatory hierarchy. The production role matrix is enforced server-side: automated tests verify that administrators receive asset-management permissions, engineers receive review permissions, citizens receive public-read permissions only, and protected admin/review mutations reject unauthorized roles before database changes.
