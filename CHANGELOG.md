# @webxr-jp/vrm-xr-tracking

## 0.2.1

### Patch Changes

- 6c4c180: ハンドトラッキングで、T ポーズのときに手首が前に 45° 曲がるのを直す。手の回転オフセットを grip の座標系経由ではなく、T ポーズでの wrist ジョイントの向きから直接決めるようにした（コントローラーのオフセットにある「握った棒の傾き」が手に掛からないように）。

## 0.2.0

### Minor Changes

- a4dfdf7: ハンドトラッキングで手首が約 90° 折れるのを直す。手は必ず wrist ジョイントから読み、手の回転オフセット（`HAND_TRACKING_ROTATION_OFFSET_*`）を WebXR の仕様に合わせて決め直した。`isHandTracking: true` で自分で手の向きを渡している場合は、向きの見直しが要る。
  
  また、dist の相対 import に `.js` を付け、Node（Vitest など）からも読めるようにした。
