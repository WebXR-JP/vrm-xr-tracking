import { Euler, MathUtils, Quaternion, Vector3 } from 'three'
import type { Side } from './poses'

/**
 * XRift が Sentry に送っているログ（xr input snapshot・tracking calibration）の属性を読む
 *
 * - `left.joints` / `right.joints`: 手首から見た関節。`名前:x,y,z,rx,ry,rz,r` を `;` でつなぐ
 *   （位置と太さは mm、向きは XYZ のオイラー角で度）
 * - `left.pose` / `right.pose`: 頭の真下の床を原点・頭の向きを -Z にした手首（か握り）の姿勢
 *   `x,y,z,rx,ry,rz`（mm と度）。tracking calibration だけにある
 */
export type LogAttributes = Record<string, string | number | boolean>

/** 貼り付けたテキストを属性にする（JSON か、`キー: 値` / `キー<タブ>値` の行） */
export function parseAttributes(text: string): LogAttributes {
  const trimmed = text.trim()
  if (!trimmed) return {}
  try {
    const json: unknown = JSON.parse(trimmed)
    if (json && typeof json === 'object') return flattenAttributes(json as Record<string, unknown>)
  } catch {
    // JSON でなければ行として読む
  }
  const attributes: LogAttributes = {}
  for (const line of trimmed.split('\n')) {
    const match = line.match(/^\s*"?([\w.]+)"?\s*[:\t ]\s*(.+?)\s*,?\s*$/)
    if (!match) continue
    attributes[match[1]] = match[2].replace(/^"(.*)"$/, '$1')
  }
  return attributes
}

/** Sentry の JSON（`attributes` の中・`{ value, type }` の形）もほどく */
function flattenAttributes(source: Record<string, unknown>): LogAttributes {
  const inner = source.attributes
  const record =
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? (inner as Record<string, unknown>)
      : source
  const attributes: LogAttributes = {}
  for (const [key, raw] of Object.entries(record)) {
    const value =
      raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value
    }
  }
  return attributes
}

/** 手首から見た関節 1 つ */
export interface JointInWrist {
  position: Vector3
  quaternion: Quaternion
}

const toRadians = (degrees: string) => MathUtils.degToRad(Number(degrees) || 0)

/** `left.joints` の文字列を、名前ごとの手首から見た位置（m）・向きにする */
export function parseJoints(text: string): Map<string, JointInWrist> {
  const joints = new Map<string, JointInWrist>()
  for (const entry of text.split(';')) {
    const [name, values] = entry.split(':')
    if (!name || !values) continue
    const [x, y, z, rx, ry, rz] = values.split(',')
    joints.set(name.trim(), {
      position: new Vector3(Number(x) || 0, Number(y) || 0, Number(z) || 0).multiplyScalar(0.001),
      quaternion: new Quaternion().setFromEuler(
        new Euler(toRadians(rx), toRadians(ry), toRadians(rz), 'XYZ'),
      ),
    })
  }
  return joints
}

/** `left.pose` の文字列を、位置（m）と向きにする */
export function parsePose(text: string): { position: Vector3; quaternion: Quaternion } | null {
  const values = text.split(',')
  if (values.length < 6) return null
  const [x, y, z, rx, ry, rz] = values
  return {
    position: new Vector3(Number(x) || 0, Number(y) || 0, Number(z) || 0).multiplyScalar(0.001),
    quaternion: new Quaternion().setFromEuler(
      new Euler(toRadians(rx), toRadians(ry), toRadians(rz), 'XYZ'),
    ),
  }
}

/**
 * 関節の並びから、手首から見た本当の指先と手のひらの向きを求める
 *
 * 指先は中指の付け根、手のひらは「指先」と「人差し指の付け根 → 小指の付け根」から。
 * 仕様どおりの端末なら、指先は -Z・手のひらは -Y になる
 */
export function handAxesInWrist(
  joints: Map<string, JointInWrist>,
  side: Side,
): { finger: Vector3; palm: Vector3 } | null {
  const middle = joints.get('middle-finger-phalanx-proximal')
  const index = joints.get('index-finger-phalanx-proximal')
  const pinky = joints.get('pinky-finger-phalanx-proximal')
  if (!middle || !index || !pinky) return null
  const finger = middle.position.clone().normalize()
  const across = index.position.clone().sub(pinky.position)
  // 右手は人差し指が親指側（手のひらを下・指先を前にすると左）。左手は鏡像
  const palm = new Vector3().crossVectors(finger, across).normalize()
  if (side === 'right') palm.negate()
  return { finger, palm }
}

/** 角度（度） */
export function angleBetween(a: Vector3, b: Vector3): number {
  return MathUtils.radToDeg(a.angleTo(b))
}

/** ログの片手 */
export interface ReplayHand {
  /** 手首から見た関節（ハンドトラッキングのときだけ） */
  joints: Map<string, JointInWrist> | null
  /** 頭から見た手首（か握り）の姿勢（tracking calibration のときだけ） */
  pose: { position: Vector3; quaternion: Quaternion } | null
}

/** 読み込んだログ */
export interface ReplayData {
  /** 端末（User-Agent とプロファイル） */
  device: string
  /** 撮ったポーズ（tracking calibration のとき） */
  step: string | null
  headHeight: number | null
  hands: Record<Side, ReplayHand>
}

/** 属性からログの中身を取り出す（手が 1 つも無ければ null） */
export function readReplay(attributes: LogAttributes): ReplayData | null {
  const read = (key: string) => {
    const value = attributes[key]
    return typeof value === 'string' && value ? value : null
  }
  const hand = (side: Side): ReplayHand => {
    const joints = read(`${side}.joints`)
    const pose = read(`${side}.pose`)
    return {
      joints: joints ? parseJoints(joints) : null,
      pose: pose ? parsePose(pose) : null,
    }
  }
  const hands = { left: hand('left'), right: hand('right') }
  const hasHand = Object.values(hands).some((h) => h.joints || h.pose)
  if (!hasHand) return null
  const profiles = read('profiles') ?? read('input0.profiles') ?? ''
  const headHeight = Number(attributes.headHeight)
  return {
    device: [read('userAgent') ?? '', profiles].filter(Boolean).join(' / '),
    step: read('step'),
    headHeight: Number.isFinite(headHeight) && headHeight > 0 ? headHeight : null,
    hands,
  }
}
