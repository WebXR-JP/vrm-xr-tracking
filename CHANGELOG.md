# @webxr-jp/vrm-xr-tracking

## 0.5.0

### Minor Changes

- bb5c617: ハンドトラッキングの指の開き（パーとチョキの違いなど）をアバターに当てられるようにする。
  
  - `computeFingerSpread`（関節の位置から）・`readHandFingers`（XR の手から曲がりと開きを一度に）で、人差し指・薬指・小指の開き（度。中指から見て親指の側が +）を求める
  - `FingerCurlData` に開き `spread` を足した（任意）。`applyFingerCurl`・`useFingerCurl` は、あれば指の根元を横にも開く。曲げた指ほど弱める

## 0.4.0

### Minor Changes

- 1c048fe: ハンドトラッキングで、親指が手のひらの前へ回り込む動きも指の曲がりに入れる。`computeFingerCurls`・`readHandFingerCurls` に手の左右（handedness）を渡すと、親指は「関節の曲がり」と「手のひらの前への回り込み」の大きいほうを使う（握りこぶしで親指が 0.3〜0.6 にとどまっていたのが 1 まで届く）。`measureThumbSwing` も足した。
  
  アバターの親指の付け根も、指の軸回りに倒すだけでなく、握りこぶしで親指が向く方向（実機のログから）へ回すようにした。親指が握った指の前へ回り込む。指ごとの値（ハンドトラッキング）がある手だけで、コントローラーのグリップでは今までどおり。

## 0.3.0

### Minor Changes

- 0941268: ハンドトラッキングの指の曲げをアバターに当てられるようにする。
  
  - `readHandFingerCurls`（XR の手から）・`computeFingerCurls`（関節の位置から）で、指ごとの曲がり（0〜1）を求める
  - `FingerCurlData` に指ごとの曲がり `fingers` を足した（任意）。`applyFingerCurl`・`useFingerCurl` は、あれば指ごとに、無ければ今までどおり手の値で 5 本をまとめて曲げる

## 0.2.1

### Patch Changes

- 6c4c180: ハンドトラッキングで、T ポーズのときに手首が前に 45° 曲がるのを直す。手の回転オフセットを grip の座標系経由ではなく、T ポーズでの wrist ジョイントの向きから直接決めるようにした（コントローラーのオフセットにある「握った棒の傾き」が手に掛からないように）。

## 0.2.0

### Minor Changes

- a4dfdf7: ハンドトラッキングで手首が約 90° 折れるのを直す。手は必ず wrist ジョイントから読み、手の回転オフセット（`HAND_TRACKING_ROTATION_OFFSET_*`）を WebXR の仕様に合わせて決め直した。`isHandTracking: true` で自分で手の向きを渡している場合は、向きの見直しが要る。
  
  また、dist の相対 import に `.js` を付け、Node（Vitest など）からも読めるようにした。
