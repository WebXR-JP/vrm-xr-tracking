import type { VRM } from '@pixiv/three-vrm'
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { createXRStore, XR } from '@react-three/xr'
import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BodyMetrics } from './bodyMetrics'
import { CameraFocus, type CameraFocusTarget, type EyeView } from './CameraFocus'
import { EyeMarker } from './EyeMarker'
import { AVATAR_COLOR, HandGizmos, type HandMetrics, INPUT_COLOR } from './HandGizmos'
import { HeadControls } from './HeadControls'
import { loadVRMFromFile, loadVRMFromURL } from './loadVRM'
import { POSE_PRESETS, SIDES } from './poses'
import { parseAttributes, type ReplayData, readReplay } from './replay'
import { buildSimFrame, eyePositionOf, type SimFrame } from './simulation'
import { mutedStyle, sectionStyle } from './styles'
import { TrackedAvatar } from './TrackedAvatar'
import {
  DEFAULT_TORSO_BEND_DEGREES,
  type TorsoBendDegrees,
  type TorsoBendKey,
  toTorsoBendConfig,
} from './torsoBend'

// 機材が無いときは main.tsx で IWER のエミュレーターを入れている（DevUI でコントローラーを動かせる）
const store = createXRStore({ emulate: false })

/** 動かし方: XR の入力（エミュレーター・実機）か、見本のポーズか */
type Mode = 'xr' | 'pose'

const panelStyle = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 320,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  padding: 12,
  background: 'rgba(0, 0, 0, 0.7)',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.5,
} as const

const SIDE_LABEL = { left: '左手', right: '右手' } as const
const NO_METRICS: HandMetrics = { left: null, right: null }
const FOCUS_OPTIONS = [
  ['body', '全身'],
  ['side', '横から'],
  ['eye', '目から'],
  ['left', '左手'],
  ['right', '右手'],
] as const

const FINGER_LABELS = [
  ['thumb', '親'],
  ['index', '人'],
  ['middle', '中'],
  ['ring', '薬'],
  ['little', '小'],
] as const

/** ずれの角度の色（10° 以内なら合っている） */
function metricColor(degrees: number): string {
  if (degrees <= 10) return '#8be28b'
  if (degrees <= 30) return '#ffd27a'
  return '#ff8a8a'
}

export function App() {
  const [vrm, setVRM] = useState<VRM | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fromGrip, setFromGrip] = useState(true)
  const [mode, setMode] = useState<Mode>('pose')
  const [presetId, setPresetId] = useState(POSE_PRESETS[0].id)
  const [logText, setLogText] = useState('')
  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [useRecordedPose, setUseRecordedPose] = useState(true)
  const [metrics, setMetrics] = useState<HandMetrics>(NO_METRICS)
  const simRef = useRef<SimFrame | null>(null)
  const [focus, setFocus] = useState<CameraFocusTarget>('body')
  const [focusVersion, setFocusVersion] = useState(0)
  const [headPitchDegrees, setHeadPitchDegrees] = useState(0)
  const [pivotOnNeck, setPivotOnNeck] = useState(true)
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetrics | null>(null)
  const [torsoBendDegrees, setTorsoBendDegrees] = useState<TorsoBendDegrees>(
    DEFAULT_TORSO_BEND_DEGREES,
  )
  const torsoBend = useMemo(() => toTorsoBendConfig(torsoBendDegrees), [torsoBendDegrees])

  // ?vrm=<URL> で最初から読む（dev/public に置いたファイルは /<名前> で読める）
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('vrm')
    if (!url) return
    loadVRMFromURL(url)
      .then(setVRM)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const preset = POSE_PRESETS.find((p) => p.id === presetId) ?? POSE_PRESETS[0]
  const hasRecordedPose = !!replay && SIDES.some((side) => replay.hands[side].pose)
  const simFrame = useMemo(
    () =>
      mode === 'pose'
        ? buildSimFrame(preset, replay, useRecordedPose, {
            pitch: (headPitchDegrees * Math.PI) / 180,
            pivotOnNeck,
          })
        : null,
    [mode, preset, replay, useRecordedPose, headPitchDegrees, pivotOnNeck],
  )
  const eyePosition = useMemo(() => (simFrame ? eyePositionOf(simFrame) : null), [simFrame])
  const isEyeView = focus === 'eye' && !!simFrame
  // 「目から」以外では null のままにして、ポーズを変えてもカメラを動かさない
  const eyeView = useMemo<EyeView | null>(
    () =>
      isEyeView && simFrame && eyePosition
        ? { position: eyePosition, pitch: simFrame.headPitch }
        : null,
    [isEyeView, simFrame, eyePosition],
  )
  useLayoutEffect(() => {
    simRef.current = simFrame
  }, [simFrame])

  const handleFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      setVRM(await loadVRMFromFile(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleFromGrip = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setFromGrip(e.target.checked)
  }, [])

  const handleMode = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setMode(e.target.value as Mode)
  }, [])

  const handlePreset = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setPresetId(e.target.value)
  }, [])

  const handleLogText = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setLogText(e.target.value)
  }, [])

  const handleLoadLog = useCallback(() => {
    const data = readReplay(parseAttributes(logText))
    setReplay(data)
    setReplayError(data ? null : '手のデータ（left.joints・left.pose など）が見つかりません')
  }, [logText])

  const handleClearLog = useCallback(() => {
    setLogText('')
    setReplay(null)
    setReplayError(null)
  }, [])

  const handleUseRecordedPose = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setUseRecordedPose(e.target.checked)
  }, [])

  const handleEnterVR = useCallback(() => {
    store.enterVR()
  }, [])

  const handleFocus = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    setFocus(e.currentTarget.value as CameraFocusTarget)
    setFocusVersion((v) => v + 1)
  }, [])

  const handleHeadPitch = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setHeadPitchDegrees(Number(e.target.value))
  }, [])

  const handlePivotOnNeck = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setPivotOnNeck(e.target.checked)
  }, [])

  const handleTorsoBend = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const key = e.target.name as TorsoBendKey
    const value = Number(e.target.value)
    setTorsoBendDegrees((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleTorsoBendReset = useCallback(() => {
    setTorsoBendDegrees(DEFAULT_TORSO_BEND_DEGREES)
  }, [])

  const isUsingRecordedPose = mode === 'pose' && useRecordedPose && hasRecordedPose

  return (
    <>
      <div style={panelStyle}>
        <label>
          VRM 1.0 を選ぶ <input type="file" accept=".vrm" onChange={handleFile} />
        </label>
        {error && <div style={{ color: '#ff8a8a' }}>{error}</div>}

        <div style={sectionStyle}>
          <strong>動かし方</strong>
          <label>
            <input
              type="radio"
              name="mode"
              value="pose"
              checked={mode === 'pose'}
              onChange={handleMode}
            />{' '}
            見本のポーズ（VR に入らずに見る）
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="xr"
              checked={mode === 'xr'}
              onChange={handleMode}
            />{' '}
            XR の入力（エミュレーター・実機）
          </label>
        </div>

        {mode === 'pose' && (
          <label style={sectionStyle}>
            ポーズ
            <select value={presetId} onChange={handlePreset} disabled={isUsingRecordedPose}>
              {POSE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === 'pose' && (
          <HeadControls
            pitchDegrees={headPitchDegrees}
            pivotOnNeck={pivotOnNeck}
            onPitchChange={handleHeadPitch}
            onPivotOnNeckChange={handlePivotOnNeck}
            metrics={bodyMetrics}
            torsoBendDegrees={torsoBendDegrees}
            onTorsoBendChange={handleTorsoBend}
            onTorsoBendReset={handleTorsoBendReset}
          />
        )}

        {mode === 'xr' && (
          <div style={sectionStyle}>
            <label>
              <input type="checkbox" checked={fromGrip} onChange={handleFromGrip} />{' '}
              握りの中心から手首へ戻す（fromGrip）
            </label>
            <button type="button" onClick={handleEnterVR} disabled={!vrm}>
              VR に入る
            </button>
          </div>
        )}

        {mode === 'pose' && (
          <div style={sectionStyle}>
            <strong>実機のログで試す</strong>
            <span style={mutedStyle}>
              XRift の Sentry のログ（xr input snapshot・tracking calibration）の属性を JSON
              か「キー: 値」の行で貼る。手の関節があれば、その端末の手の形で見本のポーズを取る
            </span>
            <textarea
              value={logText}
              onChange={handleLogText}
              rows={4}
              placeholder={'{ "left.joints": "wrist:0,0,0,…", … }'}
              style={{ fontFamily: 'monospace', fontSize: 11 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleLoadLog} disabled={!logText.trim()}>
                読み込む
              </button>
              <button type="button" onClick={handleClearLog} disabled={!replay && !logText}>
                消す
              </button>
            </div>
            {replayError && <div style={{ color: '#ff8a8a' }}>{replayError}</div>}
            {replay && (
              <div style={sectionStyle}>
                <span style={mutedStyle}>
                  {replay.device || '端末不明'}
                  {replay.step ? `（${replay.step}）` : ''}
                </span>
                {hasRecordedPose && (
                  <label>
                    <input
                      type="checkbox"
                      checked={useRecordedPose}
                      onChange={handleUseRecordedPose}
                    />{' '}
                    ログの姿勢をそのまま使う
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          見る位置
          {FOCUS_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              value={value}
              onClick={handleFocus}
              aria-pressed={focus === value}
              disabled={value === 'eye' && mode !== 'pose'}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={sectionStyle}>
          <strong>手の向きのずれ</strong>
          <span style={mutedStyle}>
            <span style={{ color: INPUT_COLOR }}>水色</span>が本当の手、
            <span style={{ color: AVATAR_COLOR }}>橙</span>
            がアバターの手。長い矢印が指先、短い矢印が手のひら
          </span>
          {SIDES.map((side) => {
            const m = metrics[side]
            const deviation = simFrame?.hands[side]?.specDeviation
            const curls = simFrame?.hands[side]?.curls
            const spread = simFrame?.hands[side]?.spread
            return (
              <div key={side}>
                {SIDE_LABEL[side]}:{' '}
                {m ? (
                  <>
                    指先 <span style={{ color: metricColor(m.finger) }}>{m.finger}°</span>・手のひら{' '}
                    <span style={{ color: metricColor(m.palm) }}>{m.palm}°</span>
                  </>
                ) : (
                  <span style={mutedStyle}>—</span>
                )}
                {deviation && (
                  <div style={mutedStyle}>
                    端末の wrist の仕様からのずれ: 指先 {deviation.finger}°・手のひら{' '}
                    {deviation.palm}°
                  </div>
                )}
                {curls && (
                  <div style={mutedStyle}>
                    指の曲がり:{' '}
                    {FINGER_LABELS.map(
                      ([finger, label]) => `${label} ${curls[finger].toFixed(2)}`,
                    ).join('・')}
                  </div>
                )}
                {spread && (
                  <div style={mutedStyle}>
                    指の開き（度）: 人 {Math.round(spread.index)}・薬 {Math.round(spread.ring)}・小{' '}
                    {Math.round(spread.little)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <Canvas camera={{ position: [1.2, 1.6, -2.2] }}>
        <XR store={store}>
          <color attach="background" args={['#1e1f24']} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[1, 3, 2]} intensity={1.5} />
          <gridHelper args={[10, 10]} />
          {vrm && (
            <TrackedAvatar
              vrm={vrm}
              fromGrip={fromGrip}
              simRef={simRef}
              firstPerson={isEyeView}
              torsoBend={torsoBend}
              onBodyMetrics={setBodyMetrics}
            />
          )}
          {/* 自分の目の前に出て邪魔なので、一人称のときは出さない */}
          {eyePosition && !isEyeView && <EyeMarker position={eyePosition} />}
          {vrm && <HandGizmos vrm={vrm} simRef={simRef} onMetrics={setMetrics} />}
          <OrbitControls makeDefault target={[0, 1.2, 0]} />
          <CameraFocus vrm={vrm} focus={focus} version={focusVersion} eyeView={eyeView} />
        </XR>
      </Canvas>
    </>
  )
}
