import type { VRM } from '@pixiv/three-vrm'
import { Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyFingerCurl,
  applyJointCurl,
  clampFingerCurl,
  createFingerCurlStates,
  getFingerJoints,
  getThumbOpposition,
} from '../fingerCurl'

const AXIS_Z = new Vector3(0, 0, 1)

/** 指先方向（左手は +X）が曲げたあとどちらを向くか */
const tipDirection = (bone: Object3D, rest: Vector3) =>
  rest.clone().applyQuaternion(bone.quaternion)

describe('clampFingerCurl', () => {
  it('0〜1 に収める', () => {
    expect(clampFingerCurl(-1)).toBe(0)
    expect(clampFingerCurl(0.4)).toBe(0.4)
    expect(clampFingerCurl(2)).toBe(1)
  })

  it('NaN は開いた手にする', () => {
    expect(clampFingerCurl(Number.NaN)).toBe(0)
  })
})

describe('getFingerJoints', () => {
  it('4本指×3関節と親指3関節を返す', () => {
    expect(getFingerJoints('left')).toHaveLength(15)
  })

  it('4本指は左右で符号が逆、親指は同じ', () => {
    const left = getFingerJoints('left')
    const right = getFingerJoints('right')
    const leftIndex = left.find((j) => j.bone === 'leftIndexProximal')
    const rightIndex = right.find((j) => j.bone === 'rightIndexProximal')
    expect(leftIndex?.angle).toBeCloseTo(-(rightIndex?.angle ?? 0))
    const leftThumb = left.find((j) => j.bone === 'leftThumbProximal')
    const rightThumb = right.find((j) => j.bone === 'rightThumbProximal')
    expect(leftThumb?.angle).toBeCloseTo(rightThumb?.angle ?? 0)
  })

  it('握ると指先が手のひら側（下）へ向く', () => {
    const leftIndex = getFingerJoints('left').find((j) => j.bone === 'leftIndexProximal')
    const rightIndex = getFingerJoints('right').find((j) => j.bone === 'rightIndexProximal')
    if (!leftIndex || !rightIndex) throw new Error('missing joint')

    const leftBone = new Object3D()
    applyJointCurl(leftBone, leftIndex.axis, leftIndex.angle, 1, createFingerCurlStates())
    expect(tipDirection(leftBone, new Vector3(1, 0, 0)).y).toBeLessThan(0)

    const rightBone = new Object3D()
    applyJointCurl(rightBone, rightIndex.axis, rightIndex.angle, 1, createFingerCurlStates())
    expect(tipDirection(rightBone, new Vector3(-1, 0, 0)).y).toBeLessThan(0)
  })
})

describe('applyJointCurl', () => {
  it('アニメーションが書かないボーンでは、毎フレーム当てても曲がりが溜まらない', () => {
    const bone = new Object3D()
    const states = createFingerCurlStates()

    applyJointCurl(bone, AXIS_Z, Math.PI / 2, 0.5, states)
    const once = bone.quaternion.clone()
    applyJointCurl(bone, AXIS_Z, Math.PI / 2, 0.5, states)

    expect(bone.quaternion.angleTo(once)).toBeCloseTo(0)
  })

  it('曲がりを 0 に戻すと元の姿勢に戻る', () => {
    const bone = new Object3D()
    const states = createFingerCurlStates()

    applyJointCurl(bone, AXIS_Z, Math.PI / 2, 1, states)
    applyJointCurl(bone, AXIS_Z, Math.PI / 2, 0, states)

    expect(bone.quaternion.angleTo(new Quaternion())).toBeCloseTo(0)
  })

  it('アニメーションが書き換えたら、その姿勢に曲がりを足す', () => {
    const bone = new Object3D()
    const states = createFingerCurlStates()
    applyJointCurl(bone, AXIS_Z, Math.PI / 2, 1, states)

    // アニメーションが X 軸回りの姿勢を書いた
    const animated = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3)
    bone.quaternion.copy(animated)
    applyJointCurl(bone, AXIS_Z, Math.PI / 2, 0, states)

    expect(bone.quaternion.angleTo(animated)).toBeCloseTo(0)
  })
})

describe('getThumbOpposition', () => {
  // 正規化した右手は指先 -X・手のひら -Y・親指の側 +Z。開いた親指は指先の方と親指の側の間を向く
  const restRight = new Vector3(-0.039, -0.013, 0.046)

  it('付け根を回すと、親指が手のひらの前（-Y）へ回り込んで指先の方（-X）へ伸びる', () => {
    const opposition = getThumbOpposition('right', restRight)
    expect(opposition).not.toBeNull()
    if (!opposition) return
    const direction = restRight
      .clone()
      .normalize()
      .applyAxisAngle(opposition.axis, opposition.angle)
    expect(direction.y).toBeLessThan(-0.4)
    expect(direction.x).toBeLessThan(-0.7)
    // 親指の側（+Z）からは離れる
    expect(direction.z).toBeLessThan(restRight.clone().normalize().z)
  })

  it('左手は鏡像（X を反転）', () => {
    const left = getThumbOpposition('left', new Vector3(0.039, -0.013, 0.046))
    const right = getThumbOpposition('right', restRight)
    expect(left?.angle).toBeCloseTo(right?.angle ?? 0)
  })

  it('次の関節の位置が 0 なら求めない', () => {
    expect(getThumbOpposition('right', new Vector3())).toBeNull()
  })
})

describe('applyFingerCurl の親指の付け根', () => {
  /** 右手の親指の付け根と次の関節だけ持つアバター */
  function thumbAvatar() {
    const metacarpal = new Object3D()
    const proximal = new Object3D()
    proximal.position.set(-0.039, -0.013, 0.046)
    metacarpal.add(proximal)
    const bones: Record<string, Object3D> = {
      rightThumbMetacarpal: metacarpal,
      rightThumbProximal: proximal,
    }
    const vrm = {
      humanoid: { getNormalizedBoneNode: (name: string) => bones[name] ?? null },
    } as unknown as VRM
    return { vrm, metacarpal, proximal }
  }

  const thumbDirection = (metacarpal: Object3D, proximal: Object3D) =>
    proximal.position.clone().normalize().applyQuaternion(metacarpal.quaternion)

  it('指ごとの値（ハンドトラッキング）があれば、親指が手のひらの前（-Y）へ回り込む', () => {
    const { vrm, metacarpal, proximal } = thumbAvatar()
    const fingers = { thumb: 1, index: 0, middle: 0, ring: 0, little: 0 }
    applyFingerCurl(
      vrm,
      { left: 0, right: 0.2, fingers: { right: fingers } },
      createFingerCurlStates(),
    )
    const direction = thumbDirection(metacarpal, proximal)
    expect(direction.y).toBeLessThan(-0.4)
    expect(direction.x).toBeLessThan(-0.7)
  })

  it('手の値だけ（コントローラーのグリップ）なら、今までどおり指の軸回りに倒す', () => {
    const { vrm, metacarpal } = thumbAvatar()
    applyFingerCurl(vrm, { left: 0, right: 1 }, createFingerCurlStates())
    const expected = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (20 * Math.PI) / 180)
    expect(metacarpal.quaternion.angleTo(expected)).toBeCloseTo(0)
  })
})
