---
"@webxr-jp/vrm-xr-tracking": minor
---

ハンドトラッキングの指の曲げをアバターに当てられるようにする。

- `readHandFingerCurls`（XR の手から）・`computeFingerCurls`（関節の位置から）で、指ごとの曲がり（0〜1）を求める
- `FingerCurlData` に指ごとの曲がり `fingers` を足した（任意）。`applyFingerCurl`・`useFingerCurl` は、あれば指ごとに、無ければ今までどおり手の値で 5 本をまとめて曲げる
