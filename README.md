# @webxr-jp/vrm-xr-tracking

WebXR の HMD とコントローラー（またはハンドトラッキング）で VRM 1.0 アバターを動かすためのライブラリです。three.js と three-vrm だけで動く計算と、React Three Fiber 用のフックを含みます。

[XRift](https://xrift.net) の VR モードで使っている実装を切り出したものです。

## できること

- **腕の IK**: コントローラーの位置へ肩・肘・手首を合わせる（Two-Bone IK、肘は重力方向へ逃がす）
- **手の向き**: コントローラーの grip とハンドトラッキングの wrist の向きを手首のボーンへ当てる
- **握りの中心 → 手首**: `gripSpace` の原点（握りこぶしの中心）に手首を合わせると手が前に出るので、手首まで戻した点を IK の目標にする（`fromGrip`）
- **上半身と腰**: 頭の向きを背骨・胸・頭に分けて回す。頭が下がった分だけ腰を下げ、しゃがみでは膝を曲げる
- **キャリブレーション**: アバターの目の位置へ XROrigin を合わせる。床の原点が遅れて確定するランタイム（Pico など）向けに、姿勢が落ち着くまで待つ判定も含む
- **指の曲げ**: 0〜1 の値で指を握る（アニメーションと重ねても曲がりが溜まらない）。ハンドトラッキングでは関節から指ごとの曲がりを求めて、1 本ずつ曲げる（`readHandFingerCurls`）

VRM 0.x には対応していません。0.x のモデルは読み込む前に 1.0 へ変換してください。

## インストール

```bash
npm install @webxr-jp/vrm-xr-tracking
```

peerDependencies: `three`, `@pixiv/three-vrm`, `@pixiv/three-vrm-animation`。
フック（`@webxr-jp/vrm-xr-tracking/react`）を使うときは `react`, `@react-three/fiber`, `@react-three/xr` も必要です。

## 使い方

```tsx
import {
  applyArmIKFromTransform,
  applyHandRotationFromTransform,
  applyUpperBodyRotation,
  extractHeadRotationFromCamera,
} from '@webxr-jp/vrm-xr-tracking'
import { useVRControllerPositions } from '@webxr-jp/vrm-xr-tracking/react'

function TrackedAvatar({ vrm }: { vrm: VRM }) {
  // 左右のコントローラーと HMD の位置・回転（XROrigin のローカル座標）
  const transformsRef = useVRControllerPositions()

  useFrame((state, delta) => {
    const camera = state.gl.xr.getCamera()
    const head = extractHeadRotationFromCamera(vrm, camera.quaternion)
    applyUpperBodyRotation(vrm, head.yaw, head.pitch, head.roll)

    const { leftController, rightController } = transformsRef.current
    vrm.scene.updateWorldMatrix(true, true)
    const sceneWorldQuat = vrm.scene.getWorldQuaternion(new Quaternion())
    applyArmIKFromTransform(vrm, leftController, rightController, sceneWorldQuat, {
      xrOriginWorldPos, // XROrigin のワールド位置
      xrOriginWorldQuat, // XROrigin のワールド回転
      fromGrip: true, // コントローラーの位置を握りの中心として扱う
    })
    applyHandRotationFromTransform(vrm, leftController, rightController, xrOriginWorldQuat)
    vrm.update(delta)
  })

  return <primitive object={vrm.scene} />
}
```

`dev/TrackedAvatar.tsx` に、XROrigin を原点に置いたままの最小の例があります。

### 座標の前提

- アバターは VRM 1.0 の正規化ボーン（`getNormalizedBoneNode`）を動かします。`vrm.update()` の前に呼んでください
- `vrm.scene` は Y 軸に 180° 回して、アバターがカメラと同じ -Z を向くように置く前提です（three-vrm の例と同じ置き方）

## 開発

```bash
npm install
npm run dev     # 確認ページ（http://localhost:5173）
npm test
npm run lint
npm run typecheck
```

### 確認ページ

`npm run dev` で開くページで、VRM 1.0 を選んで動かし方を選びます。

- **見本のポーズ**（VR に入らずに見る）: T ポーズ・手を前に出す・気をつけなどを選ぶと、WebXR の仕様どおりの wrist をハンドトラッキングとして渡してアバターを動かします
- **XR の入力**: 「VR に入る」を押すと、アバターが HMD とコントローラー（か手）について動きます
- 本当の手（水色）とアバターの手（橙）の向きを矢印で出し、指先・手のひらのずれを角度で出します（10° 以内なら緑）。「見る位置」で手に寄れます
- **実機のログで試す**: XRift が Sentry に送っているログ（xr input snapshot・tracking calibration）の属性を貼ると、その端末の手の形で見本のポーズを取ります。端末の wrist が仕様からどれだけずれているかと、指ごとの曲がりも出ます（アバターの指も曲がります）

- VR 機材が無いときは [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime)（Quest 3 のエミュレーター）が自動で入ります。画面の DevUI でコントローラーを動かせます
- 「握りの中心から手首へ戻す（fromGrip）」で、コントローラーのときの手首の合わせ方を切り替えて見比べられます
- `?vrm=<URL>` で最初から読み込めます。`dev/public/local/` に置いたファイルは `?vrm=/local/<名前>.vrm` で読めます（このフォルダは git に入りません）
- 実機で見るときは、同じネットワークのヘッドセットのブラウザから開いてください（WebXR には HTTPS が要ります）

### 手元のアプリで試す

`npm link` だと three が二重になって型が合わなくなるので、パックしたものを入れます。

```bash
npm run build && npm pack
```

```bash
cd <アプリのディレクトリ> && npm install <作った .tgz のパス>
```

## リリース（Changesets）

`package.json` の `version` は手で上げません。利用者に影響する変更を入れる PR には changeset を足します（`npx changeset`、または `.changeset/<任意の名前>.md` を直接書く）。

```md
---
"@webxr-jp/vrm-xr-tracking": patch
---

ハンドトラッキングで手首が折れるのを直す
```

- 種類の目安（0.x の間）: 機能追加・破壊的変更は `minor`、バグ修正などは `patch`
- 本文は CHANGELOG とリリース PR にそのまま載るので、利用者向けに書く
- ドキュメントや CI だけの変更には changeset は不要
- 流れ: PR を main にマージ → `chore: release packages` PR が自動で作られる（更新される）→ それをマージすると GitHub Actions が npm に公開する

## ライセンス

MIT
