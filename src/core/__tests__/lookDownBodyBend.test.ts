import type { VRM, VRMHumanoid } from '@pixiv/three-vrm'
import { Euler, Object3D, Quaternion, Vector3 } from 'three'
import {
  computePosedOffsetFromHips,
  computeRestOffsetFromHips,
  MAX_HIPS_DROP_RATIO,
  updateHipsFromHeadTracking,
} from '../tracking'
import {
  applyUpperBodyRotation,
  computeTorsoBend,
  computeTorsoBendProgress,
  DEFAULT_TORSO_BEND,
  ROTATION_DISTRIBUTION,
  type TorsoBendConfig,
} from '../vrIK'
import { extractHeadRotationFromCamera, HEAD_TO_EYE_OFFSET } from '../xrOrigin'

const DEG = Math.PI / 180
const LEG_LENGTH = 0.8
const INITIAL_HIPS_POS = new Vector3(0, 0.88, 0)

type SkeletonOptions = {
  spine?: boolean
  chest?: boolean
  upperChest?: boolean
  neck?: boolean
  eyes?: boolean
}

/**
 * 本物の Object3D を親子に組んだ VRM 1.0 風の骨格（身長 1.6m 程度。アバターは +Z を向く）
 * hips → spine → chest → upperChest → neck → head → leftEye/rightEye、hips → 脚
 * 省いた骨は、その子を一つ上の骨へつなぐ
 */
function createSkeletonVRM(options: SkeletonOptions = {}) {
  const {
    spine: withSpine = true,
    chest: withChest = true,
    upperChest: withUpperChest = true,
    neck: withNeck = true,
    eyes: withEyes = true,
  } = options
  const bones: Record<string, Object3D> = {}

  const scene = new Object3D()
  const add = (name: string, parent: Object3D, position: Vector3): Object3D => {
    const bone = new Object3D()
    bone.name = name
    bone.position.copy(position)
    parent.add(bone)
    bones[name] = bone
    return bone
  }

  const hips = add('hips', scene, INITIAL_HIPS_POS)
  let parent = hips
  if (withSpine) parent = add('spine', parent, new Vector3(0, 0.06, 0))
  if (withChest) parent = add('chest', parent, new Vector3(0, 0.12, 0))
  // 省いた骨の position は、子へ足して首から上の長さを変えない
  const carry = new Vector3()
  if (withUpperChest) parent = add('upperChest', parent, new Vector3(0, 0.12, 0))
  else carry.y += 0.12
  if (withNeck) {
    parent = add('neck', parent, new Vector3(0, 0.13 + carry.y, 0))
    carry.y = 0
  } else carry.y += 0.13
  const head = add('head', parent, new Vector3(0, 0.09 + carry.y, 0))
  if (withEyes) {
    add('leftEye', head, new Vector3(0.03, 0.08, 0.04))
    add('rightEye', head, new Vector3(-0.03, 0.08, 0.04))
  }
  for (const [side, x] of [
    ['left', 0.08],
    ['right', -0.08],
  ] as const) {
    const upperLeg = add(`${side}UpperLeg`, hips, new Vector3(x, -0.05, 0))
    const lowerLeg = add(`${side}LowerLeg`, upperLeg, new Vector3(0, -0.38, 0))
    add(`${side}Foot`, lowerLeg, new Vector3(0, -0.4, 0))
  }

  const humanoid = {
    getNormalizedBoneNode: (name: string) => bones[name] ?? null,
  } as unknown as VRMHumanoid
  const vrm = { scene, humanoid } as unknown as VRM
  return { vrm, bones, scene }
}

/** 腰から見た目の位置（いまの姿勢・基本姿勢）。目のボーンがあれば中点、無ければ頭の上 */
function eyeOffsets(bones: Record<string, Object3D>) {
  const posed = new Vector3()
  const rest = new Vector3()
  const tmp = new Vector3()
  const hips = bones.hips
  if (bones.leftEye && bones.rightEye) {
    computePosedOffsetFromHips(bones.leftEye, new Vector3(), hips, posed)
    computePosedOffsetFromHips(bones.rightEye, new Vector3(), hips, tmp)
    posed.add(tmp).multiplyScalar(0.5)
    computeRestOffsetFromHips(bones.leftEye, new Vector3(), hips, rest)
    computeRestOffsetFromHips(bones.rightEye, new Vector3(), hips, tmp)
    rest.add(tmp).multiplyScalar(0.5)
  } else {
    const local = new Vector3(0, HEAD_TO_EYE_OFFSET, 0)
    computePosedOffsetFromHips(bones.head, local, hips, posed)
    computeRestOffsetFromHips(bones.head, local, hips, rest)
  }
  return { posed, rest }
}

/** hips から見た頭の向き（hips 自身の回転は除く） */
function headQuatFromHips(bones: Record<string, Object3D>): Quaternion {
  const q = new Quaternion()
  let current: Object3D | null = bones.head
  while (current && current !== bones.hips) {
    q.premultiply(current.quaternion)
    current = current.parent
  }
  return q
}

function quatFromEuler(pitch: number, yaw: number, roll: number): Quaternion {
  return new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'))
}

/** 骨の前後の傾き（YXZ の X） */
function pitchOf(bone: Object3D): number {
  return new Euler().setFromQuaternion(bone.quaternion, 'YXZ').x
}

describe('computeTorsoBend', () => {
  it('開始角以下・上向きでは曲げない', () => {
    for (const pitch of [-60 * DEG, -10 * DEG, 0, 10 * DEG, DEFAULT_TORSO_BEND.startPitch]) {
      const bend = computeTorsoBend(pitch)
      expect(bend.spine).toBeCloseTo(0)
      expect(bend.chest).toBeCloseTo(0)
      expect(bend.upperChest).toBeCloseTo(0)
    }
  })

  it('最大角以上では最大値', () => {
    for (const pitch of [DEFAULT_TORSO_BEND.fullPitch, 90 * DEG]) {
      const bend = computeTorsoBend(pitch)
      expect(bend.spine).toBeCloseTo(DEFAULT_TORSO_BEND.maxSpine)
      expect(bend.chest).toBeCloseTo(DEFAULT_TORSO_BEND.maxChest)
      expect(bend.upperChest).toBeCloseTo(DEFAULT_TORSO_BEND.maxUpperChest)
    }
  })

  it('途中は単調に増える', () => {
    let prev = computeTorsoBend(DEFAULT_TORSO_BEND.startPitch)
    for (let deg = 16; deg <= 75; deg++) {
      const bend = computeTorsoBend(deg * DEG)
      expect(bend.spine).toBeGreaterThan(prev.spine)
      expect(bend.chest).toBeGreaterThan(prev.chest)
      expect(bend.upperChest).toBeGreaterThan(prev.upperChest)
      prev = bend
    }
  })
})

describe('computeTorsoBend（曲げる量を渡す）', () => {
  const config: TorsoBendConfig = {
    startPitch: 10 * DEG,
    fullPitch: 40 * DEG,
    maxSpine: 25 * DEG,
    maxChest: 30 * DEG,
    maxUpperChest: 20 * DEG,
    neckShare: 0.5,
    pullBack: 0.1,
    kneeDrop: 0.05,
  }

  it('config を渡すとその量になる', () => {
    expect(computeTorsoBend(10 * DEG, config)).toEqual({ spine: 0, chest: 0, upperChest: 0 })
    const full = computeTorsoBend(40 * DEG, config)
    expect(full.spine).toBeCloseTo(25 * DEG)
    expect(full.chest).toBeCloseTo(30 * DEG)
    expect(full.upperChest).toBeCloseTo(20 * DEG)
    // 真ん中は smoothstep でちょうど半分
    const half = computeTorsoBend(25 * DEG, config)
    expect(half.spine).toBeCloseTo(12.5 * DEG)
    expect(half.chest).toBeCloseTo(15 * DEG)
    expect(half.upperChest).toBeCloseTo(10 * DEG)
  })

  it('省略すると既定値と同じ', () => {
    for (const deg of [0, 20, 45, 75, 90]) {
      expect(computeTorsoBend(deg * DEG)).toEqual(computeTorsoBend(deg * DEG, DEFAULT_TORSO_BEND))
    }
  })

  it.each([
    ['最大角 = 開始角', 30 * DEG],
    ['最大角 < 開始角', 20 * DEG],
  ])('%s でも NaN にならず、開始角を超えたら最大', (_name, fullPitch) => {
    const flat = { ...config, startPitch: 30 * DEG, fullPitch }
    for (const deg of [0, 30]) {
      expect(computeTorsoBend(deg * DEG, flat)).toEqual({ spine: 0, chest: 0, upperChest: 0 })
    }
    for (const deg of [31, 90]) {
      const bend = computeTorsoBend(deg * DEG, flat)
      expect(bend.spine).toBeCloseTo(25 * DEG)
      expect(bend.chest).toBeCloseTo(30 * DEG)
    }
  })
})

describe('applyUpperBodyRotation（背中の曲げ）', () => {
  it.each([
    ['真下', 90 * DEG, 0, 0],
    ['斜め下', 45 * DEG, 0, 0],
    ['斜め下＋首を振る', 50 * DEG, 0.6, 0],
    ['斜め下＋首を振る＋かしげる', 60 * DEG, -0.8, 0.3],
    ['上向き＋かしげる', -40 * DEG, 0.4, -0.2],
  ])('%s: 背中を曲げても hips から見た頭の向きは Euler(pitch, yaw, roll) のまま', (_name, pitch, yaw, roll) => {
    const { vrm, bones } = createSkeletonVRM()

    applyUpperBodyRotation(vrm, yaw, pitch, roll)

    expect(headQuatFromHips(bones).angleTo(quatFromEuler(pitch, yaw, roll))).toBeLessThan(1e-6)
  })

  it('torsoBend を渡すとその量で倒し、頭の向きは変わらない', () => {
    const { vrm, bones } = createSkeletonVRM()
    const torsoBend: TorsoBendConfig = {
      startPitch: 0,
      fullPitch: 30 * DEG,
      maxSpine: 20 * DEG,
      maxChest: 25 * DEG,
      maxUpperChest: 5 * DEG,
      neckShare: 0.5,
      pullBack: 0,
      kneeDrop: 0,
    }

    applyUpperBodyRotation(vrm, 0.3, 60 * DEG, 0.1, torsoBend)

    const spineEuler = new Euler().setFromQuaternion(bones.spine.quaternion, 'YXZ')
    const chestEuler = new Euler().setFromQuaternion(bones.chest.quaternion, 'YXZ')
    const upperChestEuler = new Euler().setFromQuaternion(bones.upperChest.quaternion, 'YXZ')
    const neckEuler = new Euler().setFromQuaternion(bones.neck.quaternion, 'YXZ')
    expect(spineEuler.x).toBeCloseTo(20 * DEG)
    expect(chestEuler.x).toBeCloseTo(25 * DEG)
    expect(upperChestEuler.x).toBeCloseTo(5 * DEG)
    // 胴で倒した 50° の残り 10° の半分
    expect(neckEuler.x).toBeCloseTo(5 * DEG)
    expect(headQuatFromHips(bones).angleTo(quatFromEuler(60 * DEG, 0.3, 0.1))).toBeLessThan(1e-6)
  })

  it('下を向くと spine・chest・upperChest が前へ倒れる', () => {
    const { vrm, bones } = createSkeletonVRM()

    applyUpperBodyRotation(vrm, 0, 60 * DEG)

    const bend = computeTorsoBend(60 * DEG)
    expect(pitchOf(bones.spine)).toBeCloseTo(bend.spine)
    expect(pitchOf(bones.chest)).toBeCloseTo(bend.chest)
    expect(pitchOf(bones.upperChest)).toBeCloseTo(bend.upperChest)
    expect(bend.upperChest).toBeGreaterThan(0)
  })

  it('pitch 0 では今までと同じ（yaw の分配と roll だけ）', () => {
    const { vrm, bones } = createSkeletonVRM()
    const yaw = 0.7
    const roll = 0.25

    applyUpperBodyRotation(vrm, yaw, 0, roll)

    expect(
      bones.spine.quaternion.angleTo(quatFromEuler(0, yaw * ROTATION_DISTRIBUTION.spine, 0)),
    ).toBeLessThan(1e-6)
    expect(
      bones.chest.quaternion.angleTo(quatFromEuler(0, yaw * ROTATION_DISTRIBUTION.chest, 0)),
    ).toBeLessThan(1e-6)
    expect(
      bones.head.quaternion.angleTo(quatFromEuler(0, yaw * ROTATION_DISTRIBUTION.head, roll)),
    ).toBeLessThan(1e-6)
  })

  it.each([
    ['chest が無い', { chest: false }],
    ['spine が無い', { spine: false }],
    ['spine も chest も無い', { spine: false, chest: false }],
    ['upperChest が無い', { upperChest: false }],
    ['neck が無い', { neck: false }],
    ['upperChest も neck も無い', { upperChest: false, neck: false }],
  ])('%s場合も、ある骨だけで頭の向きを合わせる', (_name, options) => {
    const { vrm, bones } = createSkeletonVRM(options)
    const pitch = 70 * DEG
    const yaw = 0.5
    const roll = 0.1

    applyUpperBodyRotation(vrm, yaw, pitch, roll)

    expect(headQuatFromHips(bones).angleTo(quatFromEuler(pitch, yaw, roll))).toBeLessThan(1e-6)
  })
})

describe('符号の確認（カメラを下へ向ける → pitch → ボーン）', () => {
  it('カメラを下へ向けると pitch が正になり、頭の前（+Z）が下を向き、背中が前へ倒れる', () => {
    const { vrm, bones, scene } = createSkeletonVRM()
    // README の前提どおり、アバターがカメラと同じ -Z を向くよう scene を Y 軸に 180° 回す
    scene.rotation.y = Math.PI
    scene.updateMatrixWorld(true)
    // カメラの前（-Z）を 60° 下へ向ける
    const cameraQuat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -60 * DEG)
    const cameraForward = new Vector3(0, 0, -1).applyQuaternion(cameraQuat)
    expect(cameraForward.y).toBeLessThan(0)

    const { yaw, pitch, roll } = extractHeadRotationFromCamera(vrm, cameraQuat)
    expect(pitch).toBeCloseTo(60 * DEG)

    applyUpperBodyRotation(vrm, yaw, pitch, roll)
    scene.updateMatrixWorld(true)

    // 頭の前（+Z）がカメラの前と同じ向き（下）を向く
    const headForward = new Vector3(0, 0, 1).applyQuaternion(
      bones.head.getWorldQuaternion(new Quaternion()),
    )
    expect(headForward.y).toBeLessThan(0)
    expect(headForward.distanceTo(cameraForward)).toBeLessThan(1e-6)

    // 背中の上（chest の +Y）が、アバターの前（ワールドの -Z）へ倒れる
    const chestUp = new Vector3(0, 1, 0).applyQuaternion(
      bones.chest.getWorldQuaternion(new Quaternion()),
    )
    expect(chestUp.z).toBeLessThan(0)
  })
})

/** 体を後ろへ引かず、屈伸もしない（目がカメラに一致する）。曲げる量は既定のまま */
const NO_PULL_BACK: TorsoBendConfig = { ...DEFAULT_TORSO_BEND, pullBack: 0, kneeDrop: 0 }
/** 屈伸だけしない（体は後ろへ引く） */
const NO_KNEE_DROP: TorsoBendConfig = { ...DEFAULT_TORSO_BEND, kneeDrop: 0 }

/** 骨格を作り、背中を曲げてから腰を置く。torsoBend は両方へ同じものを渡す（省略すると既定値） */
function apply(
  pitch: number,
  yaw: number,
  roll: number,
  relativeHeadChange: Vector3,
  options: SkeletonOptions = {},
  torsoBend?: TorsoBendConfig,
) {
  const skeleton = createSkeletonVRM(options)
  applyUpperBodyRotation(skeleton.vrm, yaw, pitch, roll, torsoBend)
  updateHipsFromHeadTracking(
    skeleton.vrm,
    relativeHeadChange,
    INITIAL_HIPS_POS.clone(),
    false,
    LEG_LENGTH,
    torsoBend,
  )
  return skeleton
}

describe('updateHipsFromHeadTracking（目がカメラの位置に来るよう腰を置く）', () => {
  it.each([
    ['斜め下', 45 * DEG, 0, 0],
    ['真下＋首を振る', 90 * DEG, 0.6, 0],
    ['斜め下＋首を振る＋かしげる', 30 * DEG, -0.5, 0.3],
    ['首を振るだけ', 0, 1.0, 0],
  ])('%s: 水平（X・Z）では hips + e が initialHips + e0 + 頭の移動量に一致する', (_name, pitch, yaw, roll) => {
    const rel = new Vector3(0.02, -0.03, 0.05)
    const { bones } = apply(pitch, yaw, roll, rel, {}, NO_PULL_BACK)
    const { posed, rest } = eyeOffsets(bones)

    const avatarEye = bones.hips.position.clone().add(posed)
    const target = INITIAL_HIPS_POS.clone().add(rest).add(rel)
    expect(avatarEye.x).toBeCloseTo(target.x, 6)
    expect(avatarEye.z).toBeCloseTo(target.z, 6)
  })

  it('しゃがみながら下を向く（補正後も下がる）ときは、高さも目がカメラに一致する', () => {
    const rel = new Vector3(0, -0.2, 0.05)
    const { bones } = apply(45 * DEG, 0, 0, rel, {}, NO_PULL_BACK)
    const { posed, rest } = eyeOffsets(bones)

    const avatarEye = bones.hips.position.clone().add(posed)
    const target = INITIAL_HIPS_POS.clone().add(rest).add(rel)
    expect(avatarEye.y).toBeCloseTo(target.y, 6)
    expect(bones.hips.position.y).toBeLessThan(INITIAL_HIPS_POS.y)
  })

  it('下を向いて頭が少し下がっただけなら、腰は立ち姿勢の高さで止まる（上がらない）', () => {
    const rel = new Vector3(0, -0.03, 0.08)
    const { bones } = apply(60 * DEG, 0, 0, rel, {}, NO_KNEE_DROP)

    expect(bones.hips.position.y).toBeCloseTo(INITIAL_HIPS_POS.y, 6)
  })

  it('頭が上がっているときは、腰を上げるのは頭が上がった分まで', () => {
    const rel = new Vector3(0, 0.04, 0)
    const { bones } = apply(60 * DEG, 0, 0, rel, {}, NO_KNEE_DROP)

    expect(bones.hips.position.y).toBeCloseTo(INITIAL_HIPS_POS.y + 0.04, 6)
  })

  it('真下を見る（頭の移動 0）と、腰は後ろ（-Z）へ下がり、屈伸の分だけ下がる', () => {
    const { bones } = apply(90 * DEG, 0, 0, new Vector3())

    expect(bones.hips.position.z).toBeLessThan(INITIAL_HIPS_POS.z - 0.1)
    expect(bones.hips.position.x).toBeCloseTo(0, 6)
    expect(bones.hips.position.y).toBeCloseTo(INITIAL_HIPS_POS.y - DEFAULT_TORSO_BEND.kneeDrop, 6)
  })

  it('直立（回転なし）では今までと同じ（初期位置＋頭の移動量）', () => {
    const rel = new Vector3(0.1, -0.02, 0.05)
    const { bones } = apply(0, 0, 0, rel)

    expect(bones.hips.position.x).toBeCloseTo(0.1)
    expect(bones.hips.position.y).toBeCloseTo(INITIAL_HIPS_POS.y - 0.02)
    expect(bones.hips.position.z).toBeCloseTo(0.05)
  })

  it('下を向いて頭が数 cm 下がっただけでは膝を曲げない（屈伸しない config）', () => {
    // 下を向いて頭が下がった分は背中の曲げで打ち消され、しゃがみとはみなさない
    const { bones } = apply(80 * DEG, 0, 0, new Vector3(0, -0.06, 0.09), {}, NO_KNEE_DROP)

    expect(bones.leftUpperLeg.rotation.x).toBe(0)
    expect(bones.leftLowerLeg.rotation.x).toBe(0)
  })

  it('本当にしゃがんだときは膝を曲げる', () => {
    const { bones } = apply(10 * DEG, 0, 0, new Vector3(0, -0.3, 0))

    expect(bones.leftUpperLeg.rotation.x).toBeLessThan(0)
    expect(bones.leftLowerLeg.rotation.x).toBeGreaterThan(0)
  })

  it('目のボーンが無いアバターでは、頭の上 HEAD_TO_EYE_OFFSET を目として合わせる', () => {
    const rel = new Vector3(0, -0.2, 0.03)
    const { bones } = apply(60 * DEG, 0.3, 0, rel, { eyes: false }, NO_PULL_BACK)
    const { posed, rest } = eyeOffsets(bones)

    const avatarEye = bones.hips.position.clone().add(posed)
    const target = INITIAL_HIPS_POS.clone().add(rest).add(rel)
    expect(avatarEye.distanceTo(target)).toBeLessThan(1e-6)
    expect(bones.hips.position.z).toBeLessThan(0)
  })

  it('head も無いアバターでは補正しない（今までの動き）', () => {
    const hips = new Object3D()
    const humanoid = {
      getNormalizedBoneNode: (name: string) => (name === 'hips' ? hips : null),
    } as unknown as VRMHumanoid
    const vrm = { scene: new Object3D(), humanoid } as unknown as VRM
    const rel = new Vector3(0.01, -0.02, 0.03)

    updateHipsFromHeadTracking(vrm, rel, INITIAL_HIPS_POS.clone(), false, LEG_LENGTH)

    expect(hips.position.x).toBeCloseTo(0.01)
    expect(hips.position.y).toBeCloseTo(INITIAL_HIPS_POS.y - 0.02)
    expect(hips.position.z).toBeCloseTo(0.03)
  })
})

describe('updateHipsFromHeadTracking（下を向くと体を後ろへ引く）', () => {
  const rel = new Vector3(0.02, -0.03, 0.05)
  /** 引かないだけ（屈伸は既定のまま）。引いた量だけを比べる */
  const NO_PULL_BACK_ONLY: TorsoBendConfig = { ...DEFAULT_TORSO_BEND, pullBack: 0 }

  it('pullBack: 0 では引かない（目がカメラに一致する）', () => {
    const { bones } = apply(90 * DEG, 0.4, 0.1, rel, {}, NO_PULL_BACK)
    const { posed, rest } = eyeOffsets(bones)

    const avatarEye = bones.hips.position.clone().add(posed)
    const target = INITIAL_HIPS_POS.clone().add(rest).add(rel)
    expect(avatarEye.x).toBeCloseTo(target.x, 6)
    expect(avatarEye.z).toBeCloseTo(target.z, 6)
  })

  it('真下（90°）では、pullBack: 0 のときよりちょうど pullBack だけ後ろ（-Z）。高さは同じ', () => {
    const base = apply(90 * DEG, 0, 0, rel, {}, NO_PULL_BACK_ONLY).bones.hips.position
    const pulled = apply(90 * DEG, 0, 0, rel).bones.hips.position

    expect(pulled.z - base.z).toBeCloseTo(-DEFAULT_TORSO_BEND.pullBack, 6)
    expect(pulled.x).toBeCloseTo(base.x, 6)
    expect(pulled.y).toBeCloseTo(base.y, 6)
  })

  it('pullBack を渡すとその量だけ引く', () => {
    const config = { ...DEFAULT_TORSO_BEND, pullBack: 0.3 }
    const base = apply(90 * DEG, 0, 0, rel, {}, { ...config, pullBack: 0 }).bones.hips.position
    const pulled = apply(90 * DEG, 0, 0, rel, {}, config).bones.hips.position

    expect(pulled.z - base.z).toBeCloseTo(-0.3, 6)
  })

  it.each([
    ['正面', 0],
    ['上向き', -45 * DEG],
    ['真上', -90 * DEG],
    ['開始角', DEFAULT_TORSO_BEND.startPitch],
  ])('%s では引かない', (_name, pitch) => {
    const base = apply(pitch, 0.3, 0, rel, {}, NO_PULL_BACK_ONLY).bones.hips.position
    const pulled = apply(pitch, 0.3, 0, rel).bones.hips.position

    expect(pulled.distanceTo(base)).toBeLessThan(1e-9)
  })

  it('開始角と最大角の間では、0 と最大の間（進み具合 × pullBack）', () => {
    const pitch = 45 * DEG
    const base = apply(pitch, 0, 0, rel, {}, NO_PULL_BACK_ONLY).bones.hips.position
    const pulled = apply(pitch, 0, 0, rel).bones.hips.position
    const expected = computeTorsoBendProgress(pitch) * DEFAULT_TORSO_BEND.pullBack

    expect(base.z - pulled.z).toBeGreaterThan(0)
    expect(base.z - pulled.z).toBeLessThan(DEFAULT_TORSO_BEND.pullBack)
    expect(base.z - pulled.z).toBeCloseTo(expected, 6)
  })

  it.each([
    ['yaw 90° で真下', 90 * DEG, 90 * DEG],
    ['yaw -60° で斜め下', 80 * DEG, -60 * DEG],
  ])('%s: 引く向きは頭の方位の逆', (_name, pitch, yaw) => {
    const base = apply(pitch, yaw, 0, rel, {}, NO_PULL_BACK_ONLY).bones.hips.position
    const pulled = apply(pitch, yaw, 0, rel).bones.hips.position
    const delta = pulled.clone().sub(base)
    // アバターは +Z 向き。yaw で回した頭の方位は (sin yaw, 0, cos yaw)
    const heading = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const expected = computeTorsoBendProgress(pitch) * DEFAULT_TORSO_BEND.pullBack

    expect(delta.y).toBeCloseTo(0, 9)
    expect(delta.length()).toBeCloseTo(expected, 6)
    expect(delta.normalize().dot(heading)).toBeCloseTo(-1, 6)
  })

  it('省略すると DEFAULT_TORSO_BEND', () => {
    const skeleton = createSkeletonVRM()
    applyUpperBodyRotation(skeleton.vrm, 0.2, 80 * DEG, 0)
    updateHipsFromHeadTracking(skeleton.vrm, rel, INITIAL_HIPS_POS.clone(), false, LEG_LENGTH)

    const explicit = apply(80 * DEG, 0.2, 0, rel, {}, DEFAULT_TORSO_BEND).bones.hips.position
    expect(skeleton.bones.hips.position.distanceTo(explicit)).toBeLessThan(1e-12)
  })

  it('head が無いアバターでは引かない', () => {
    const hips = new Object3D()
    const humanoid = {
      getNormalizedBoneNode: (name: string) => (name === 'hips' ? hips : null),
    } as unknown as VRMHumanoid
    const vrm = { scene: new Object3D(), humanoid } as unknown as VRM

    updateHipsFromHeadTracking(vrm, rel, INITIAL_HIPS_POS.clone(), false, LEG_LENGTH, {
      ...DEFAULT_TORSO_BEND,
      pullBack: 0.5,
    })

    expect(hips.position.x).toBeCloseTo(0.02)
    expect(hips.position.z).toBeCloseTo(0.05)
  })
})

describe('computeTorsoBendProgress', () => {
  it('開始角以下で 0、最大角以上で 1、computeTorsoBend と同じ進み具合', () => {
    expect(computeTorsoBendProgress(DEFAULT_TORSO_BEND.startPitch)).toBe(0)
    expect(computeTorsoBendProgress(-30 * DEG)).toBe(0)
    expect(computeTorsoBendProgress(DEFAULT_TORSO_BEND.fullPitch)).toBe(1)
    expect(computeTorsoBendProgress(90 * DEG)).toBe(1)
    const t = computeTorsoBendProgress(40 * DEG)
    expect(computeTorsoBend(40 * DEG).spine).toBeCloseTo(t * DEFAULT_TORSO_BEND.maxSpine)
  })
})

describe('computePosedOffsetFromHips / computeRestOffsetFromHips', () => {
  it('基本姿勢では両者が一致する', () => {
    const { bones } = createSkeletonVRM()
    const posed = new Vector3()
    const rest = new Vector3()

    expect(computePosedOffsetFromHips(bones.leftEye, new Vector3(), bones.hips, posed)).toBe(true)
    expect(computeRestOffsetFromHips(bones.leftEye, new Vector3(), bones.hips, rest)).toBe(true)
    expect(posed.distanceTo(rest)).toBeLessThan(1e-9)
    expect(rest.y).toBeCloseTo(0.06 + 0.12 + 0.12 + 0.13 + 0.09 + 0.08)
  })

  it('hips の回転も含め、hips の位置は足さない', () => {
    const { bones } = createSkeletonVRM()
    bones.hips.rotation.x = Math.PI / 2
    const posed = new Vector3()

    computePosedOffsetFromHips(bones.head, new Vector3(), bones.hips, posed)

    // +Y の頭が、hips の +X 回り 90° で +Z へ向く
    expect(posed.y).toBeCloseTo(0)
    expect(posed.z).toBeCloseTo(0.06 + 0.12 + 0.12 + 0.13 + 0.09)
  })

  it('hips の下に無い骨では false を返す', () => {
    const { bones } = createSkeletonVRM()
    const stray = new Object3D()

    expect(computePosedOffsetFromHips(stray, new Vector3(), bones.hips, new Vector3())).toBe(false)
    expect(computeRestOffsetFromHips(stray, new Vector3(), bones.hips, new Vector3())).toBe(false)
  })
})

describe('applyUpperBodyRotation（背骨の弧と首の分担）', () => {
  const sumBend = (bend: { spine: number; chest: number; upperChest: number }) =>
    bend.spine + bend.chest + bend.upperChest

  it('upperChest がある骨格では、spine・chest・upperChest の 3 か所に分かれる', () => {
    const { vrm, bones } = createSkeletonVRM()

    applyUpperBodyRotation(vrm, 0, 90 * DEG)

    expect(pitchOf(bones.spine)).toBeCloseTo(DEFAULT_TORSO_BEND.maxSpine)
    expect(pitchOf(bones.chest)).toBeCloseTo(DEFAULT_TORSO_BEND.maxChest)
    expect(pitchOf(bones.upperChest)).toBeCloseTo(DEFAULT_TORSO_BEND.maxUpperChest)
  })

  it('upperChest が無いと、その分が chest に足されて合計の前傾は同じ', () => {
    const withUpper = createSkeletonVRM()
    const without = createSkeletonVRM({ upperChest: false })
    const pitch = 50 * DEG

    applyUpperBodyRotation(withUpper.vrm, 0, pitch)
    applyUpperBodyRotation(without.vrm, 0, pitch)

    const bend = computeTorsoBend(pitch)
    expect(pitchOf(without.bones.chest)).toBeCloseTo(bend.chest + bend.upperChest)
    const totalWith =
      pitchOf(withUpper.bones.spine) +
      pitchOf(withUpper.bones.chest) +
      pitchOf(withUpper.bones.upperChest)
    const totalWithout = pitchOf(without.bones.spine) + pitchOf(without.bones.chest)
    expect(totalWithout).toBeCloseTo(totalWith)
    // 首の傾きも同じ（胴の合計が同じなので）
    expect(pitchOf(without.bones.neck)).toBeCloseTo(pitchOf(withUpper.bones.neck))
  })

  it.each([
    ['真下', 90 * DEG],
    ['斜め下（曲げの途中）', 40 * DEG],
    ['開始角より浅い下向き', 10 * DEG],
    ['上向き', -40 * DEG],
  ])('%s: neck は (pitch − 胴の合計) × neckShare だけ前後に傾く', (_name, pitch) => {
    const { vrm, bones } = createSkeletonVRM()

    applyUpperBodyRotation(vrm, 0, pitch)

    const expected = (pitch - sumBend(computeTorsoBend(pitch))) * DEFAULT_TORSO_BEND.neckShare
    expect(pitchOf(bones.neck)).toBeCloseTo(expected)
    if (pitch < 0) expect(pitchOf(bones.neck)).toBeLessThan(0)
  })

  it('neck は yaw・roll を持たない（X 軸回りだけ）', () => {
    const { vrm, bones } = createSkeletonVRM()

    applyUpperBodyRotation(vrm, 0.8, 60 * DEG, 0.3)

    const euler = new Euler().setFromQuaternion(bones.neck.quaternion, 'YXZ')
    expect(euler.y).toBeCloseTo(0)
    expect(euler.z).toBeCloseTo(0)
  })

  it.each([
    ['upperChest も neck もある', {}],
    ['upperChest が無い', { upperChest: false }],
    ['neck が無い', { neck: false }],
  ] as const)('%s: yaw・roll を混ぜても hips から見た頭の向きは Euler(pitch, yaw, roll) と一致する', (_name, options) => {
    for (const [pitch, yaw, roll] of [
      [90 * DEG, 0.6, 0.2],
      [45 * DEG, -0.9, -0.3],
      [-50 * DEG, 0.4, 0.25],
    ]) {
      const { vrm, bones } = createSkeletonVRM(options)
      applyUpperBodyRotation(vrm, yaw, pitch, roll)
      expect(headQuatFromHips(bones).angleTo(quatFromEuler(pitch, yaw, roll))).toBeLessThan(1e-6)
    }
  })

  it('pitch 0・yaw 0 では upperChest・neck が単位回転（前のフレームの値も消す）', () => {
    const { vrm, bones } = createSkeletonVRM()
    applyUpperBodyRotation(vrm, 0.5, 80 * DEG, 0.2)

    applyUpperBodyRotation(vrm, 0, 0, 0.2)

    const identity = new Quaternion()
    expect(bones.upperChest.quaternion.angleTo(identity)).toBeLessThan(1e-9)
    expect(bones.neck.quaternion.angleTo(identity)).toBeLessThan(1e-9)
  })
})

describe('updateHipsFromHeadTracking（下を向くと屈伸する）', () => {
  const rel = new Vector3(0.02, -0.03, 0.05)

  it('真下では kneeDrop: 0 のときよりちょうど kneeDrop だけ腰が下がり、膝が曲がる', () => {
    const base = apply(90 * DEG, 0, 0, rel, {}, NO_KNEE_DROP).bones
    const dropped = apply(90 * DEG, 0, 0, rel).bones

    expect(base.hips.position.y - dropped.hips.position.y).toBeCloseTo(
      DEFAULT_TORSO_BEND.kneeDrop,
      6,
    )
    expect(dropped.hips.position.x).toBeCloseTo(base.hips.position.x, 6)
    expect(dropped.hips.position.z).toBeCloseTo(base.hips.position.z, 6)
    expect(dropped.leftUpperLeg.rotation.x).toBeLessThan(0)
    expect(dropped.leftLowerLeg.rotation.x).toBeGreaterThan(0)
  })

  it('kneeDrop を渡すとその量だけ下がる', () => {
    const config = { ...DEFAULT_TORSO_BEND, kneeDrop: 0.15 }
    const base = apply(90 * DEG, 0, 0, rel, {}, NO_KNEE_DROP).bones.hips.position
    const dropped = apply(90 * DEG, 0, 0, rel, {}, config).bones.hips.position

    expect(base.y - dropped.y).toBeCloseTo(0.15, 6)
  })

  it.each([
    ['正面', 0],
    ['上向き', -45 * DEG],
  ])('%s では下がらない', (_name, pitch) => {
    const base = apply(pitch, 0.3, 0, rel, {}, NO_KNEE_DROP).bones.hips.position
    const dropped = apply(pitch, 0.3, 0, rel).bones.hips.position

    expect(dropped.y).toBeCloseTo(base.y, 9)
  })

  it('脚の長さに対する上限（clampHipsDropY）は守る', () => {
    // 深くしゃがんだまま真下を見る
    const deep = new Vector3(0, -LEG_LENGTH, 0)
    const { bones } = apply(90 * DEG, 0, 0, deep, {}, { ...DEFAULT_TORSO_BEND, kneeDrop: 0.3 })

    expect(bones.hips.position.y).toBeCloseTo(
      INITIAL_HIPS_POS.y - LEG_LENGTH * MAX_HIPS_DROP_RATIO,
      6,
    )
  })

  it('head が無いアバターでは下がらない', () => {
    const hips = new Object3D()
    const humanoid = {
      getNormalizedBoneNode: (name: string) => (name === 'hips' ? hips : null),
    } as unknown as VRMHumanoid
    const vrm = { scene: new Object3D(), humanoid } as unknown as VRM

    updateHipsFromHeadTracking(vrm, rel, INITIAL_HIPS_POS.clone(), false, LEG_LENGTH, {
      ...DEFAULT_TORSO_BEND,
      kneeDrop: 0.5,
    })

    expect(hips.position.y).toBeCloseTo(INITIAL_HIPS_POS.y - 0.03)
  })
})
