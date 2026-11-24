import { Matrix4, Quaternion, Vector3 } from 'three'

export type Side = 'left' | 'right'
export const SIDES: readonly Side[] = ['left', 'right']

type Vec3 = readonly [number, number, number]

/** 見本のポーズの片手（ユーザーは -Z を向き、右手は +X 側） */
interface PresetHand {
  /** 手首の位置（m） */
  position: Vec3
  /** 指先の向き */
  finger: Vec3
  /** 手のひらの向き（手のひらから外へ） */
  palm: Vec3
}

export interface PosePreset {
  id: string
  label: string
  hands: Record<Side, PresetHand>
}

/** 左右で鏡像にする（X を反転） */
function mirror(hand: PresetHand): PresetHand {
  const flip = (v: Vec3): Vec3 => [-v[0], v[1], v[2]]
  return { position: flip(hand.position), finger: flip(hand.finger), palm: flip(hand.palm) }
}

function preset(id: string, label: string, right: PresetHand): PosePreset {
  return { id, label, hands: { right, left: mirror(right) } }
}

/** 見本のポーズ（目の高さ 1.6m くらいの人） */
export const POSE_PRESETS: readonly PosePreset[] = [
  preset('tPose', 'T ポーズ（手のひらを下）', {
    position: [0.75, 1.45, 0],
    finger: [1, 0, 0],
    palm: [0, -1, 0],
  }),
  preset('forwardDown', '前に出す・手のひらを下', {
    position: [0.18, 1.35, -0.55],
    finger: [0, 0, -1],
    palm: [0, -1, 0],
  }),
  preset('forwardIn', '前に出す・手のひらを向かい合わせ', {
    position: [0.18, 1.35, -0.55],
    finger: [0, 0, -1],
    palm: [-1, 0, 0],
  }),
  preset('forwardUp', '前に出す・手のひらを上', {
    position: [0.18, 1.35, -0.55],
    finger: [0, 0, -1],
    palm: [0, 1, 0],
  }),
  preset('armsDown', '気をつけ（手のひらを体へ）', {
    position: [0.22, 0.85, 0],
    finger: [0, -1, 0],
    palm: [-1, 0, 0],
  }),
]

const _basis = new Matrix4()

/**
 * 指先と手のひらの向きから、WebXR の仕様どおりの wrist の向きを作る
 * （-Z が指先の方、-Y が手のひらの外。手のひらは指先と直交するよう直す）
 */
export function specWristQuat(finger: Vector3, palm: Vector3): Quaternion {
  const z = finger.clone().normalize().negate()
  const y = palm.clone().negate()
  y.sub(z.clone().multiplyScalar(y.dot(z))).normalize()
  const x = new Vector3().crossVectors(y, z)
  return new Quaternion().setFromRotationMatrix(_basis.makeBasis(x, y, z))
}

/** 見本の片手を、位置・指先・手のひらの Vector3 にする */
export function presetHand(hand: PresetHand): {
  position: Vector3
  finger: Vector3
  palm: Vector3
} {
  return {
    position: new Vector3(...hand.position),
    finger: new Vector3(...hand.finger).normalize(),
    palm: new Vector3(...hand.palm).normalize(),
  }
}
