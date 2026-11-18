import { Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyJointCurl,
  clampFingerCurl,
  createFingerCurlStates,
  getFingerJoints,
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
