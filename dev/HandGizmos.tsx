import type { VRM } from '@pixiv/three-vrm'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useMemo, useRef } from 'react'
import { ArrowHelper, Color, type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { useVRControllerPositions } from '../src/react'
import { SIDES, type Side } from './poses'
import type { SimFrame } from './simulation'

/** 左右それぞれの、アバターの手と本当の手の向きの差（度） */
export type HandMetrics = Record<Side, { finger: number; palm: number } | null>

type Props = {
  vrm: VRM
  simRef: RefObject<SimFrame | null>
  onMetrics: (metrics: HandMetrics) => void
}

/** 本当の手（入力）の色と、アバターの手の色 */
export const INPUT_COLOR = '#4fd1ff'
export const AVATAR_COLOR = '#ffa24f'

const FINGER_LENGTH = 0.16
const PALM_LENGTH = 0.09
const MAX_JOINTS = 26 * 2
const METRICS_INTERVAL = 0.25

const _handQuat = new Quaternion()
const _handPos = new Vector3()
const _finger = new Vector3()
const _palm = new Vector3()
const _inputFinger = new Vector3()
const _inputPalm = new Vector3()
const _matrix = new Matrix4()
const _hidden = new Matrix4().makeScale(0, 0, 0)

function createArrow(color: string, length: number, dimmed = false): ArrowHelper {
  const c = new Color(color)
  if (dimmed) c.multiplyScalar(0.6)
  const arrow = new ArrowHelper(new Vector3(0, 0, -1), new Vector3(), length, c, 0.03, 0.02)
  // 体や手のメッシュに埋もれないよう、いつも手前に描く
  for (const material of [arrow.line.material, arrow.cone.material]) {
    const list = Array.isArray(material) ? material : [material]
    for (const m of list) m.depthTest = false
  }
  arrow.renderOrder = 10
  arrow.line.renderOrder = 10
  arrow.cone.renderOrder = 10
  arrow.visible = false
  return arrow
}

interface SideArrows {
  inputFinger: ArrowHelper
  inputPalm: ArrowHelper
  avatarFinger: ArrowHelper
  avatarPalm: ArrowHelper
}

/**
 * 本当の手（水色）とアバターの手（橙）の向きを矢印で出す。長い矢印が指先、短い矢印が手のひら
 *
 * アバターの手は正規化ボーンの向きから（VRM 1.0 の手は右が -X、左が +X に伸び、手のひらは -Y）
 */
export function HandGizmos({ vrm, simRef, onMetrics }: Props) {
  const transformsRef = useVRControllerPositions()
  const jointsRef = useRef<InstancedMesh>(null)
  const elapsedRef = useRef(0)
  const lastMetricsRef = useRef('')

  const arrows = useMemo(
    () =>
      Object.fromEntries(
        SIDES.map((side) => [
          side,
          {
            inputFinger: createArrow(INPUT_COLOR, FINGER_LENGTH),
            inputPalm: createArrow(INPUT_COLOR, PALM_LENGTH, true),
            avatarFinger: createArrow(AVATAR_COLOR, FINGER_LENGTH),
            avatarPalm: createArrow(AVATAR_COLOR, PALM_LENGTH, true),
          },
        ]),
      ) as Record<Side, SideArrows>,
    [],
  )

  useFrame((state, delta) => {
    const sim = state.gl.xr.isPresenting ? null : simRef.current
    const metrics: HandMetrics = { left: null, right: null }
    let jointCount = 0

    for (const side of SIDES) {
      const set = arrows[side]
      const simHand = sim?.hands[side] ?? null
      const live = sim
        ? null
        : side === 'left'
          ? transformsRef.current.leftController
          : transformsRef.current.rightController
      const transform = simHand?.transform ?? live ?? null
      const bone = vrm.humanoid.getNormalizedBoneNode(side === 'left' ? 'leftHand' : 'rightHand')
      const raw = vrm.humanoid.getRawBoneNode(side === 'left' ? 'leftHand' : 'rightHand')
      const visible = !!transform && !!bone && !!raw
      for (const arrow of Object.values(set)) arrow.visible = visible
      if (!transform || !bone || !raw) continue

      // 本当の手: シミュレーションならその向き、XR のハンドトラッキングなら仕様どおりの wrist から
      if (simHand?.finger && simHand.palm) {
        _inputFinger.copy(simHand.finger)
        _inputPalm.copy(simHand.palm)
      } else if (transform.isHandTracking) {
        _inputFinger.set(0, 0, -1).applyQuaternion(transform.rotation)
        _inputPalm.set(0, -1, 0).applyQuaternion(transform.rotation)
      } else {
        set.inputFinger.visible = false
        set.inputPalm.visible = false
      }
      set.inputFinger.position.copy(transform.position)
      set.inputFinger.setDirection(_inputFinger)
      set.inputPalm.position.copy(transform.position)
      set.inputPalm.setDirection(_inputPalm)

      bone.getWorldQuaternion(_handQuat)
      raw.getWorldPosition(_handPos)
      _finger.set(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(_handQuat)
      _palm.set(0, -1, 0).applyQuaternion(_handQuat)
      set.avatarFinger.position.copy(_handPos)
      set.avatarFinger.setDirection(_finger)
      set.avatarPalm.position.copy(_handPos)
      set.avatarPalm.setDirection(_palm)

      if (set.inputFinger.visible) {
        metrics[side] = {
          finger: Math.round((_finger.angleTo(_inputFinger) * 180) / Math.PI),
          palm: Math.round((_palm.angleTo(_inputPalm) * 180) / Math.PI),
        }
      }

      const mesh = jointsRef.current
      for (const joint of simHand?.joints ?? []) {
        if (!mesh || jointCount >= MAX_JOINTS) break
        mesh.setMatrixAt(jointCount++, _matrix.makeTranslation(joint))
      }
    }

    const mesh = jointsRef.current
    if (mesh) {
      for (let i = jointCount; i < MAX_JOINTS; i++) mesh.setMatrixAt(i, _hidden)
      mesh.instanceMatrix.needsUpdate = true
    }

    elapsedRef.current += delta
    if (elapsedRef.current < METRICS_INTERVAL) return
    elapsedRef.current = 0
    const key = JSON.stringify(metrics)
    if (key === lastMetricsRef.current) return
    lastMetricsRef.current = key
    onMetrics(metrics)
  })

  return (
    <>
      {SIDES.map((side) =>
        Object.entries(arrows[side]).map(([name, arrow]) => (
          <primitive key={`${side}-${name}`} object={arrow} />
        )),
      )}
      <instancedMesh ref={jointsRef} args={[undefined, undefined, MAX_JOINTS]}>
        <sphereGeometry args={[0.006, 8, 8]} />
        <meshBasicMaterial color={INPUT_COLOR} />
      </instancedMesh>
    </>
  )
}
