---
"@webxr-jp/vrm-xr-tracking": minor
---

ハンドトラッキングの指の開き（パーとチョキの違いなど）をアバターに当てられるようにする。

- `computeFingerSpread`（関節の位置から）・`readHandFingers`（XR の手から曲がりと開きを一度に）で、人差し指・薬指・小指の開き（度。中指から見て親指の側が +）を求める
- `FingerCurlData` に開き `spread` を足した（任意）。`applyFingerCurl`・`useFingerCurl` は、あれば指の根元を横にも開く。曲げた指ほど弱める
