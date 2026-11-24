# @webxr-jp/vrm-xr-tracking

## 0.2.0

### Minor Changes

- a4dfdf7: ハンドトラッキングで手首が約 90° 折れるのを直す。手は必ず wrist ジョイントから読み、手の回転オフセット（`HAND_TRACKING_ROTATION_OFFSET_*`）を WebXR の仕様に合わせて決め直した。`isHandTracking: true` で自分で手の向きを渡している場合は、向きの見直しが要る。
  
  また、dist の相対 import に `.js` を付け、Node（Vitest など）からも読めるようにした。
