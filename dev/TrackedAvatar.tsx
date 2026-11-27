import type { VRM } from '@pixiv/three-vrm'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useRef } from 'react'
import { Euler, type Group, Quaternion, Vector3 } from 'three'
import {
  applyArmIKFromTransform,
  applyHandRotationFromTransform,
  applyUpperBodyRotation,
  extractCameraWorldYaw,
  extractHeadRotationFromCamera,
  type FingerCurlData,
  type FingerCurls,
  type FingerSpread,
  getAvatarEyeWorldPosition,
  measureLegLength,
  readHandFingers,
  type TorsoBendConfig,
  updateHipsFromHeadTracking,
} from '../src'
import { useFingerCurl, useVRControllerPositions } from '../src/react'
import {
  type BodyMetrics,
  bodyMetricsKey,
  measureBodyMetrics,
  worldDeltaToSceneLocal,
} from './bodyMetrics'
import { eyePositionOf, type SimFrame } from './simulation'

type Props = {
  vrm: VRM
  /** コントローラーの位置を握りの中心として扱う（手首まで戻す） */
  fromGrip: boolean
  /** VR に入らずに動かすとき（見本のポーズ・ログの再生）の手と頭。null なら XR の入力を使う */
  simRef: RefObject<SimFrame | null>
  /** 一人称で見ている（VR と同じく頭を隠す） */
  firstPerson: boolean
  /** 下を向いたときに背中を曲げる量（確認ページのスライダーの値。見本のポーズでも XR の入力でも使う） */
  torsoBend: TorsoBendConfig
  /** 見本のポーズのときの腰の動き。値が変わったときだけ呼ぶ（XR の入力のときは null） */
  onBodyMetrics: (metrics: BodyMetrics | null) => void
}

/** 基本姿勢で控えておく値（VRM を読んだ直後に 1 回だけ） */
interface RestPose {
  vrm: VRM
  initialHipsPos: Vector3
  /** 縮尺を掛ける前の足の長さ */
  legLength: number
}

const METRICS_INTERVAL = 0.25

const ORIGIN = new Vector3()
const IDENTITY = new Quaternion()
const _sceneWorldQuat = new Quaternion()
const _tempEuler = new Euler()
const _relativeHeadChange = new Vector3()

/** 5 本の平均（指ごとの値を知らない相手のための手の値） */
function averageCurl(curls: FingerCurls): number {
  return (curls.thumb + curls.index + curls.middle + curls.ring + curls.little) / 5
}

type HandFingers = { curls: FingerCurls; spread: FingerSpread | null } | null

/** 左右の指ごとの曲がりと開きを、同期と同じ形（FingerCurlData）にまとめる */
function toFingerCurlData(
  left: HandFingers,
  right: HandFingers,
  out: FingerCurlData,
): FingerCurlData {
  out.left = left ? averageCurl(left.curls) : 0
  out.right = right ? averageCurl(right.curls) : 0
  out.fingers = { left: left?.curls, right: right?.curls }
  out.spread = { left: left?.spread ?? undefined, right: right?.spread ?? undefined }
  return out
}

const LEG_BONES = ['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg'] as const

/**
 * 腰を基本姿勢の位置へ、脚をまっすぐに戻す。
 * XR の入力では updateHipsFromHeadTracking を呼ばないので、見本のポーズで書いた腰のずれと膝の曲げが残らないように毎フレーム書く
 */
function resetHipsAndLegs(vrm: VRM, initialHipsPos: Vector3): void {
  vrm.humanoid.getNormalizedBoneNode('hips')?.position.copy(initialHipsPos)
  for (const name of LEG_BONES) {
    const bone = vrm.humanoid.getNormalizedBoneNode(name)
    if (bone) bone.rotation.x = 0
  }
}

const handFingersOf = (hand: { curls: FingerCurls | null; spread: FingerSpread | null } | null) =>
  hand?.curls ? { curls: hand.curls, spread: hand.spread } : null

const _curlData: FingerCurlData = { left: 0, right: 0 }
const _xrFingers: Record<'left' | 'right', { curls: FingerCurls; spread: FingerSpread }> = {
  left: {
    curls: { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 },
    spread: { index: 0, ring: 0, little: 0 },
  },
  right: {
    curls: { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 },
    spread: { index: 0, ring: 0, little: 0 },
  },
}

/**
 * HMD とコントローラーでアバターを動かす（XROrigin は原点に置いたまま）。
 * 体は頭の真下に置いて頭の向きへ回し、目の高さが HMD に合うよう縮尺を合わせる
 */
export function TrackedAvatar({
  vrm,
  fromGrip,
  simRef,
  firstPerson,
  torsoBend,
  onBodyMetrics,
}: Props) {
  const groupRef = useRef<Group>(null)
  const eyeHeightRef = useRef<number | null>(null)
  const restPoseRef = useRef<RestPose | null>(null)
  const metricsElapsedRef = useRef(0)
  const lastMetricsRef = useRef('')
  const transformsRef = useVRControllerPositions()
  const { updateFingerCurl } = useFingerCurl({ vrm })

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return
    const camera = state.gl.xr.isPresenting ? state.gl.xr.getCamera() : state.camera

    if (eyeHeightRef.current === null) {
      vrm.scene.updateMatrixWorld(true)
      eyeHeightRef.current = getAvatarEyeWorldPosition(vrm).y / group.scale.y
    }
    // 腰を動かす前（基本姿勢）の hips の位置と足の長さを控える。足の長さはワールドで測るので縮尺で割って戻す
    if (restPoseRef.current?.vrm !== vrm) {
      const hips = vrm.humanoid.getNormalizedBoneNode('hips')
      vrm.scene.updateMatrixWorld(true)
      restPoseRef.current = {
        vrm,
        initialHipsPos: hips ? hips.position.clone() : new Vector3(),
        legLength: measureLegLength(vrm) / group.scale.y,
      }
    }
    const restPose = restPoseRef.current

    // 一人称で頭の中が映らないよう、VR の間（と確認ページの「目から」）は頭（髪ごと）を縮めて隠す
    vrm.humanoid
      .getRawBoneNode('head')
      ?.scale.setScalar(state.gl.xr.isPresenting || firstPerson ? 0 : 1)

    const sim = state.gl.xr.isPresenting ? null : simRef.current
    if (sim) {
      // ユーザーは -Z を向いて立っている。体を頭の真下に置き、目の高さを頭に合わせる
      group.scale.setScalar(sim.headPosition.y / eyeHeightRef.current)
      group.position.set(sim.headPosition.x, 0, sim.headPosition.z)
      group.rotation.set(0, Math.PI, 0)
      group.updateMatrixWorld(true)
      // XRift 本体と同じ順: 上半身 → 腰 → 腕。腰は背中と頭の回転を読むので上半身の後に置く
      applyUpperBodyRotation(vrm, 0, sim.headPitch, 0, torsoBend)
      worldDeltaToSceneLocal(sim.headChange, group, _relativeHeadChange)
      updateHipsFromHeadTracking(
        vrm,
        _relativeHeadChange,
        restPose.initialHipsPos,
        false,
        restPose.legLength,
        // group の縮尺で割らず、scene ローカルの m としてそのまま渡す（パッケージ本体と同じ意味にするため）
        torsoBend,
      )

      const left = sim.hands.left?.transform ?? null
      const right = sim.hands.right?.transform ?? null
      vrm.scene.updateWorldMatrix(true, true)
      vrm.scene.getWorldQuaternion(_sceneWorldQuat)
      applyArmIKFromTransform(vrm, left, right, _sceneWorldQuat, {
        xrOriginWorldPos: ORIGIN,
        xrOriginWorldQuat: IDENTITY,
        fromGrip,
      })
      applyHandRotationFromTransform(vrm, left, right, IDENTITY)
    } else if (state.gl.xr.isPresenting) {
      // 目の高さを HMD に合わせ、体を頭の真下で頭の向きへ回す（VRM 1.0 は +Z 向きなので π 足す）
      group.scale.setScalar(camera.position.y / eyeHeightRef.current)
      group.position.set(camera.position.x, 0, camera.position.z)
      const cameraYaw = extractCameraWorldYaw(camera.quaternion, _tempEuler)
      group.rotation.set(0, cameraYaw + Math.PI, 0)
      group.updateMatrixWorld(true)
      resetHipsAndLegs(vrm, restPose.initialHipsPos)

      const head = extractHeadRotationFromCamera(vrm, camera.quaternion)
      applyUpperBodyRotation(vrm, head.yaw, head.pitch, head.roll, torsoBend)

      const { leftController, rightController } = transformsRef.current
      vrm.scene.updateWorldMatrix(true, true)
      vrm.scene.getWorldQuaternion(_sceneWorldQuat)
      applyArmIKFromTransform(vrm, leftController, rightController, _sceneWorldQuat, {
        xrOriginWorldPos: ORIGIN,
        xrOriginWorldQuat: IDENTITY,
        fromGrip,
      })
      applyHandRotationFromTransform(vrm, leftController, rightController, IDENTITY)
    }

    // 指の曲がり: シミュレーションはログの関節から、XR はハンドトラッキングの関節から
    if (sim) {
      updateFingerCurl(
        toFingerCurlData(handFingersOf(sim.hands.left), handFingersOf(sim.hands.right), _curlData),
        delta,
      )
    } else if (state.gl.xr.isPresenting) {
      const session = state.gl.xr.getSession()
      const frame = state.gl.xr.getFrame()
      const space = state.gl.xr.getReferenceSpace()
      const read: Record<'left' | 'right', HandFingers> = { left: null, right: null }
      if (session && frame && space) {
        for (const source of session.inputSources) {
          if (!source.hand || source.handedness === 'none') continue
          const out = _xrFingers[source.handedness]
          if (readHandFingers(frame, source.hand, space, source.handedness, out)) {
            read[source.handedness] = out
          }
        }
      }
      updateFingerCurl(toFingerCurlData(read.left, read.right, _curlData), delta)
    }

    vrm.update(delta)

    // 毎フレーム setState しないよう、間を空けて値が変わったときだけ知らせる（HandGizmos と同じ）
    metricsElapsedRef.current += delta
    if (metricsElapsedRef.current < METRICS_INTERVAL) return
    metricsElapsedRef.current = 0
    const metrics = sim
      ? measureBodyMetrics(vrm, restPose.initialHipsPos, group.scale.z, eyePositionOf(sim))
      : null
    const key = bodyMetricsKey(metrics)
    if (key === lastMetricsRef.current) return
    lastMetricsRef.current = key
    onBodyMetrics(metrics)
  })

  return (
    <group ref={groupRef} rotation={[0, Math.PI, 0]}>
      <primitive object={vrm.scene} />
    </group>
  )
}
