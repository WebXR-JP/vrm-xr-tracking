---
"@webxr-jp/vrm-xr-tracking": minor
---

VR で下を向いたときに、VRChat のように背中を弧に曲げ、腰を後ろへ逃がして少し屈伸し、足元（床）が見えるようにする。

- `applyUpperBodyRotation`: 下向きの pitch に応じて spine・chest・upperChest の 3 か所を前へ倒し、背骨をなめらかな弧にする（15° から曲げ始め、75° で spine 10°・chest 12°・upperChest 12°）。upperChest が無いアバターでは、その分を chest に足す（合計の前傾は同じ）。頭の向き（hips から見た向き）は今までと同じ。曲げる量は 5 つ目の引数 `torsoBend`（`TorsoBendConfig`）で差し替えられる。省略すると `DEFAULT_TORSO_BEND`。曲げる量は `computeTorsoBend(pitch, config?)`（戻り値に `upperChest` も入る）で求められる
- `applyUpperBodyRotation`: 頭の付け根 1 か所で折れないよう、首（neck）にも前後の傾きを持たせる。neck の傾き = (pitch − 胴の前傾の合計) × `neckShare`（既定 `0.4`。上向きにも効く。X 軸回りだけで、yaw・roll は頭が持つ）。neck が無いアバターでは頭が全部持つ
- `applyUpperBodyRotation`: **`upperChest` と `neck` のボーンも毎フレーム書くようになった**（曲げが 0 なら単位回転）。アニメーションなどでこの 2 つを回していた場合は上書きされる
- `updateHipsFromHeadTracking`: 腰を「アバターの目がカメラの位置に来る」ところへ置くようにした。下を向くと腰が後ろへ下がる。腰は立ち姿勢より上げないので、深く下を向くとアバターの頭がカメラより数 cm 低くなる。下を向いて頭が少し下がった分はしゃがみとみなさない（膝を曲げるのは、下の屈伸で落とした分から）
- `updateHipsFromHeadTracking`: 背中を曲げても胸の前面が視界に残るので、下を向いたときだけ体全体を水平に後ろ（頭が向いている方位の逆）へ引く。曲げと同じ進み具合で増え、真下で最大 12cm（`TorsoBendConfig.pullBack`、既定 `0.12`、vrm.scene のローカルの m）。一人称では頭を描かないので分からないが、アバターの目はその分カメラより後ろへずれる。`pullBack: 0` で引かない（目がカメラに一致する）。6 つ目の引数 `torsoBend` で渡す（省略すると `DEFAULT_TORSO_BEND`。`applyUpperBodyRotation` と同じものを渡す）
- `updateHipsFromHeadTracking`: 脚がまっすぐのまま上体だけ曲げると不自然なので、下を向いたときに屈伸する。曲げと同じ進み具合で腰を落とし、真下で最大 6cm（`TorsoBendConfig.kneeDrop`、既定 `0.06`、vrm.scene のローカルの m）。その分アバターの目はカメラより低くなる。`kneeDrop: 0` で落とさない（`pullBack: 0` と合わせると目がカメラに一致する）。head が無いアバターでは落とさない
- `TorsoBendConfig` に `maxUpperChest`・`neckShare`・`kneeDrop` を足した（必須）。自前で `TorsoBendConfig` を組み立てている場合は、`{ ...DEFAULT_TORSO_BEND, ... }` のように足す
- 膝の曲げ方を変えた（**ふつうのしゃがみの見た目も変わる**）。今までの式（太もも 0.55π × 比・膝 1.1π × 比）は腰を落とした量に対して曲げが足りず、足が床に沈んでいた（脚 0.8m で 20cm 落とすと約 13cm 沈む）。太ももとすねを同じ長さとみなし、足が床に残る角度（太ももの前への傾き a = acos(1 − 縮める量 / 脚の長さ)、膝 2a）にした。角度は `computeKneeBendAngles(drop, legLength)` で求められる
- 膝の曲げ始めを連続にした。今までは腰が 5cm 下がると急に曲げ始めていた（`CROUCH_THRESHOLD`）が、遊び `KNEE_BEND_DEADZONE`（3cm）を引いた量 max(0, d − 3cm) で曲げるようにした（立っているときの頭の小さな上下で膝が震えないための遊び）。落ちた量が遊び以下なら、今までどおり脚に触らない（脚のアニメーションを上書きしない）。**`CROUCH_THRESHOLD` は削除した**
- 膝の曲げ始めをなめらかにした。遊びを超えた量 x をそのまま縮めると、遊びを 1mm 超えただけで太もも約 3°・膝約 6° 曲がって境目で膝が震えるので、脚を縮める量を x² / (x + `KNEE_BEND_SOFTNESS`) にした（`KNEE_BEND_SOFTNESS` は既定 `0.02` m、export した）。曲げ始めの角度が x にほぼ比例する代わりに、深くしゃがむと足が最大 2cm ほど床へ沈む
- `updateHipsFromHeadTracking`: この関数が膝を曲げたあと遊び以下に戻ったら、1 回だけ脚を 0（まっすぐ）に戻す（止まっているときに顔を上げても膝が曲がったまま残らないように）。一度も曲げていなければ今までどおり脚に触らない
- 曲げの進み具合（0〜1）を求める `computeTorsoBendProgress(pitch, config?)` を export した
- **`updateHipsFromHeadTracking` は `applyUpperBodyRotation` の後に呼ぶ**（背中と頭の回転を読むため）。今までの引数は変わらない（6 つ目は省略できる）ので、リモートのアバターも同じ値を渡せば同じ姿勢になる
- 腰から見た目の位置を求める `computePosedOffsetFromHips`・`computeRestOffsetFromHips` と、`HEAD_TO_EYE_OFFSET` を export した
