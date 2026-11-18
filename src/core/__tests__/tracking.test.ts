import type { VRM, VRMHumanoid } from '@pixiv/three-vrm'
import { Object3D, Quaternion, Vector3 } from 'three'
import {
  CROUCH_THRESHOLD,
  clampHipsDropY,
  HEAD_CHANGE_THRESHOLD,
  isRapidPositionChange,
  measureLegLength,
  POSE_PLAUSIBILITY_TIMEOUT_MS,
  POSE_STABLE_FRAMES_REQUIRED,
  updateHipsFromHeadTracking,
  updatePoseStabilityCount,
} from '../tracking'
import { DEFAULT_LEG_LENGTH } from '../vrIK'

function createMockBoneNode(position: Vector3 = new Vector3()): Object3D {
  const bone = new Object3D()
  bone.position.copy(position)
  bone.getWorldPosition = vi.fn((target: Vector3) => target.copy(position))
  bone.getWorldQuaternion = vi.fn((target: Quaternion) => target.identity())
  bone.updateMatrixWorld = vi.fn()
  return bone
}

function createMockVRM(options: { bones?: Record<string, Object3D | null> } = {}): VRM {
  const { bones = {} } = options

  const scene = new Object3D()
  scene.getWorldQuaternion = vi.fn((target: Quaternion) => target.identity())
  scene.getWorldPosition = vi.fn((target: Vector3) => target.set(0, 0, 0))

  const humanoid = {
    getNormalizedBoneNode: vi.fn((name: string) => bones[name] ?? null),
    resetNormalizedPose: vi.fn(),
  } as unknown as VRMHumanoid

  return {
    scene,
    humanoid,
    update: vi.fn(),
  } as unknown as VRM
}

describe('tracking', () => {
  describe('CROUCH_THRESHOLD', () => {
    it('5cmのしきい値が設定されている', () => {
      expect(CROUCH_THRESHOLD).toBe(0.05)
    })
  })

  describe('measureLegLength', () => {
    it('ボーンが存在しない場合はデフォルト値を返す', () => {
      const vrm = createMockVRM({ bones: {} })
      const result = measureLegLength(vrm)
      expect(result).toBe(DEFAULT_LEG_LENGTH)
    })

    it('一部のボーンがない場合はデフォルト値を返す', () => {
      const vrm = createMockVRM({
        bones: {
          leftUpperLeg: createMockBoneNode(new Vector3(0, 1, 0)),
          leftLowerLeg: null,
          leftFoot: null,
        },
      })
      const result = measureLegLength(vrm)
      expect(result).toBe(DEFAULT_LEG_LENGTH)
    })

    it('ボーンが存在する場合は正しい長さを計算する', () => {
      const upperLegPos = new Vector3(0, 1.0, 0)
      const lowerLegPos = new Vector3(0, 0.5, 0)
      const footPos = new Vector3(0, 0.1, 0)

      const vrm = createMockVRM({
        bones: {
          leftUpperLeg: createMockBoneNode(upperLegPos),
          leftLowerLeg: createMockBoneNode(lowerLegPos),
          leftFoot: createMockBoneNode(footPos),
        },
      })

      const result = measureLegLength(vrm)
      // upperLeg to lowerLeg: 0.5, lowerLeg to foot: 0.4
      expect(result).toBeCloseTo(0.9)
    })
  })

  describe('HEAD_CHANGE_THRESHOLD', () => {
    it('10cmのしきい値が設定されている', () => {
      expect(HEAD_CHANGE_THRESHOLD).toBe(0.1)
    })
  })

  describe('updateHipsFromHeadTracking', () => {
    it('relativeHeadChangeがnullの場合はスキップする', () => {
      const vrm = createMockVRM({
        bones: { hips: createMockBoneNode(new Vector3(0, 1, 0)) },
      })
      const hips = vrm.humanoid!.getNormalizedBoneNode('hips')!
      const originalY = hips.position.y

      updateHipsFromHeadTracking(vrm, null, new Vector3(0, 1, 0), false, 0.8)

      expect(hips.position.y).toBe(originalY)
    })

    it('initialHipsPosがnullの場合はスキップする', () => {
      const vrm = createMockVRM({
        bones: { hips: createMockBoneNode(new Vector3(0, 1, 0)) },
      })
      const hips = vrm.humanoid!.getNormalizedBoneNode('hips')!
      const originalY = hips.position.y

      updateHipsFromHeadTracking(vrm, new Vector3(0, -0.1, 0), null, false, 0.8)

      expect(hips.position.y).toBe(originalY)
    })

    it('isRapidMovementがtrueの場合はスキップする', () => {
      const vrm = createMockVRM({
        bones: { hips: createMockBoneNode(new Vector3(0, 1, 0)) },
      })
      const hips = vrm.humanoid!.getNormalizedBoneNode('hips')!
      const originalY = hips.position.y

      updateHipsFromHeadTracking(vrm, new Vector3(0, -0.1, 0), new Vector3(0, 1, 0), true, 0.8)

      expect(hips.position.y).toBe(originalY)
    })

    it('hipsボーンがない場合はスキップする', () => {
      const vrm = createMockVRM({ bones: {} })

      // エラーが起きないことを確認
      expect(() => {
        updateHipsFromHeadTracking(vrm, new Vector3(0, -0.1, 0), new Vector3(0, 1, 0), false, 0.8)
      }).not.toThrow()
    })

    it('hips位置が初期位置+相対移動量に更新される', () => {
      const hipsNode = createMockBoneNode(new Vector3(0, 1, 0))
      const vrm = createMockVRM({ bones: { hips: hipsNode } })
      const initialHipsPos = new Vector3(0, 1, 0)
      const relativeHead = new Vector3(0.1, -0.02, 0.05)

      updateHipsFromHeadTracking(vrm, relativeHead, initialHipsPos, false, 0.8)

      const hips = vrm.humanoid!.getNormalizedBoneNode('hips')!
      expect(hips.position.x).toBeCloseTo(0.1)
      expect(hips.position.y).toBeCloseTo(0.98)
      expect(hips.position.z).toBeCloseTo(0.05)
    })

    it('CROUCH_THRESHOLDを超えるhips下降では膝曲げが適用される', () => {
      const hipsNode = createMockBoneNode(new Vector3(0, 1, 0))
      // 膝曲げに必要なボーンも用意
      const vrm = createMockVRM({
        bones: {
          hips: hipsNode,
          leftUpperLeg: createMockBoneNode(new Vector3(-0.1, 0.9, 0)),
          rightUpperLeg: createMockBoneNode(new Vector3(0.1, 0.9, 0)),
          leftLowerLeg: createMockBoneNode(new Vector3(-0.1, 0.5, 0)),
          rightLowerLeg: createMockBoneNode(new Vector3(0.1, 0.5, 0)),
        },
      })
      const initialHipsPos = new Vector3(0, 1, 0)
      // Y方向に-0.1m移動 → hipsDropAmount = 0.1 > CROUCH_THRESHOLD(0.05)
      const relativeHead = new Vector3(0, -0.1, 0)

      updateHipsFromHeadTracking(vrm, relativeHead, initialHipsPos, false, 0.8)

      const hips = vrm.humanoid!.getNormalizedBoneNode('hips')!
      expect(hips.position.y).toBeCloseTo(0.9)
    })

    it('CROUCH_THRESHOLD以下のhips下降では膝曲げが適用されない', () => {
      const hipsNode = createMockBoneNode(new Vector3(0, 1, 0))
      const vrm = createMockVRM({ bones: { hips: hipsNode } })
      const initialHipsPos = new Vector3(0, 1, 0)
      // Y方向に-0.03m移動 → hipsDropAmount = 0.03 < CROUCH_THRESHOLD(0.05)
      const relativeHead = new Vector3(0, -0.03, 0)

      updateHipsFromHeadTracking(vrm, relativeHead, initialHipsPos, false, 0.8)

      const hips = vrm.humanoid!.getNormalizedBoneNode('hips')!
      // 位置は更新されるが膝曲げは適用されない
      expect(hips.position.y).toBeCloseTo(0.97)
    })
  })

  describe('isRapidPositionChange', () => {
    it('prevPosがnullの場合はfalseを返す', () => {
      const currentPos = new Vector3(1, 0, 0)

      const result = isRapidPositionChange(currentPos, null)

      expect(result).toBe(false)
    })

    it('移動量がしきい値以下の場合はfalseを返す', () => {
      const currentPos = new Vector3(0.05, 0, 0) // 5cm移動
      const prevPos = new Vector3(0, 0, 0)

      const result = isRapidPositionChange(currentPos, prevPos)

      expect(result).toBe(false)
    })

    it('移動量がしきい値を超える場合はtrueを返す', () => {
      const currentPos = new Vector3(0.2, 0, 0) // 20cm移動（テレポート相当）
      const prevPos = new Vector3(0, 0, 0)

      const result = isRapidPositionChange(currentPos, prevPos)

      expect(result).toBe(true)
    })

    it('ちょうどしきい値の場合はfalseを返す', () => {
      const currentPos = new Vector3(0.1, 0, 0) // ちょうど10cm
      const prevPos = new Vector3(0, 0, 0)

      const result = isRapidPositionChange(currentPos, prevPos)

      expect(result).toBe(false)
    })

    it('カスタムしきい値を使用できる', () => {
      const currentPos = new Vector3(0.05, 0, 0)
      const prevPos = new Vector3(0, 0, 0)

      // しきい値0.1だと5cmは範囲内
      expect(isRapidPositionChange(currentPos, prevPos, 0.1)).toBe(false)
      // しきい値0.03だと5cmは範囲外
      expect(isRapidPositionChange(currentPos, prevPos, 0.03)).toBe(true)
    })

    it('3D空間での距離を正しく計算する', () => {
      const currentPos = new Vector3(0.06, 0.06, 0.06) // sqrt(0.06^2 * 3) ≈ 0.1039
      const prevPos = new Vector3(0, 0, 0)

      const result = isRapidPositionChange(currentPos, prevPos)

      expect(result).toBe(true) // 0.1039 > 0.1
    })
  })

  describe('updatePoseStabilityCount', () => {
    it('前フレームのYがnullの場合は0を返す（安定判定できない）', () => {
      const result = updatePoseStabilityCount(1.6, null, 0, 5)

      expect(result).toBe(0)
    })

    it('妥当な高さで安定していればカウントを加算する', () => {
      const result = updatePoseStabilityCount(1.6, 1.61, 100, 3)

      expect(result).toBe(4)
    })

    it('フレーム間のY変化がしきい値以上なら0に戻す', () => {
      // 床原点確定によるジャンプ（1.6m → 1.7m）
      const result = updatePoseStabilityCount(1.7, 1.6, 100, 9)

      expect(result).toBe(0)
    })

    it('タイムアウト前は高さが低すぎるとカウントしない（未確定ポーズ）', () => {
      // 床原点未確定でHMDがy≈0を報告しているケース
      const result = updatePoseStabilityCount(0.01, 0.01, 500, 3)

      expect(result).toBe(0)
    })

    it('タイムアウト後は高さチェックを免除して安定性のみで判定する', () => {
      // 'local'等の目線原点ランタイム（Yが常に0付近）
      const result = updatePoseStabilityCount(0.01, 0.01, POSE_PLAUSIBILITY_TIMEOUT_MS, 3)

      expect(result).toBe(4)
    })

    it('妥当な高さでも不安定なら0に戻す', () => {
      const result = updatePoseStabilityCount(1.6, 1.5, POSE_PLAUSIBILITY_TIMEOUT_MS + 100, 9)

      expect(result).toBe(0)
    })

    it('必要フレーム数まで連続加算できる', () => {
      let count = 0
      // 1フレーム目はprev=nullで0のまま
      count = updatePoseStabilityCount(1.6, null, 0, count)
      for (let i = 0; i < POSE_STABLE_FRAMES_REQUIRED; i++) {
        count = updatePoseStabilityCount(1.6, 1.6, 100 + i, count)
      }

      expect(count).toBe(POSE_STABLE_FRAMES_REQUIRED)
    })
  })
})

describe('clampHipsDropY', () => {
  it('脚の長さの 85% までは頭の変化をそのまま使う', () => {
    expect(clampHipsDropY(-0.3, 0.8)).toBeCloseTo(-0.3)
    expect(clampHipsDropY(0.05, 0.8)).toBeCloseTo(0.05)
  })

  it('それより下へは下げない（腰が床を突き抜けない）', () => {
    expect(clampHipsDropY(-1.1, 0.8)).toBeCloseTo(-0.68)
  })
})
