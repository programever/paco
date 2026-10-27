import { useMemo, useRef } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { LatLon, Plane, project } from '../core/geo';
import { checkpointLabel, Race } from '../core/race';
import { atKm, Point, Route, slice } from '../core/route';
import { colors, kmValue, mono } from './theme';

/** The map draws in these units; the screen scales them to its width. */
export const mapWidth = 320;
export const mapHeight = 300;
const padding = 16;

/** Screen distance between direction arrows: zooming in shows more arrows, not wider gaps. */
const arrowSpacing = 44;

/** Names are drawn only when zoomed in enough to have room. */
const labelScale = 60;

/** Where the map looks: a centre in the course projection and SVG units per km. */
export type MapView = { readonly centre: Plane; readonly scale: number };

export type You =
  | { readonly kind: 'measured'; readonly at: LatLon; readonly accuracyM: number }
  | { readonly kind: 'declared' }
  | { readonly kind: 'none' };

type Props = {
  race: Race;
  view: MapView;
  onView: (view: MapView) => void;
  reachedKm: number;
  /** How far past the runner the course carries direction arrows. */
  aheadKm: number;
  you: You;
  lost: boolean;
  uncertain: boolean;
  /** The nearest point on the course: the dashed line home, drawn only when lost. */
  wayBack: LatLon | null;
  /** The finger on the profile, mirrored here. */
  cursorKm: number | null;
  breadcrumbs: readonly LatLon[];
};

/**
 * The course drawn straight from the GPX, with no tiles: tiles need a network,
 * and the moment a runner most needs a map is the moment they have none.
 */
export function CourseMap(props: Props) {
  const { race, view, reachedKm, you } = props;
  const { route } = race;
  const toScreen = (p: Plane) => ({
    x: mapWidth / 2 + (p.x - view.centre.x) * view.scale,
    y: mapHeight / 2 + (p.y - view.centre.y) * view.scale,
  });
  const screenOf = (position: LatLon) => toScreen(project(route.projection, position));
  const onScreen = (points: Point[]) => points.map((p) => toScreen(p.plane));
  const gestures = useMapGestures(route, view, props.onView);

  // Behind the runner first, then ahead on top: where the course uses the same
  // ground twice, the part still to run wins, and its grey edge shows it has
  // been run once already.
  const behind = onScreen(slice(route, 0, reachedKm));
  const ahead = onScreen(slice(route, reachedKm, route.totalKm));
  const arrows = arrowsAlong(onScreen(slice(route, reachedKm, reachedKm + props.aheadKm)));
  const youColour = props.lost ? colors.lost : props.uncertain ? colors.uncertain : colors.you;

  return (
    <View {...gestures.panHandlers} onLayout={(e) => gestures.setWidth(e.nativeEvent.layout.width)}>
      <Svg width="100%" height={mapHeight} viewBox={`0 0 ${mapWidth} ${mapHeight}`} style={{ backgroundColor: colors.mapGround }}>
        <Path d={pathOf(behind)} fill="none" stroke={colors.passed} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
        <Path d={pathOf(ahead)} fill="none" stroke={colors.route} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        {arrows.map((a, i) => (
          <Path
            key={i}
            d="M-3.5 -3.5 L1.5 0 L-3.5 3.5"
            fill="none"
            stroke={colors.paper}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            transform={`translate(${a.x} ${a.y}) rotate(${a.angle})`}
          />
        ))}
        {race.checkpoints.map((c) => {
          const s = toScreen(atKm(route, c.km).plane);
          const colour = c.km <= reachedKm ? colors.passed : colors.checkpoint;
          return (
            <G key={c.id}>
              <Circle cx={s.x} cy={s.y} r={5.5} fill={colour} stroke={colors.ink} strokeWidth={1.5} />
              {view.scale > labelScale && (
                <SvgText x={s.x + 9} y={s.y + 4} fill={colour} fontSize={9} fontFamily={mono}>
                  {checkpointLabel(c)}
                </SvgText>
              )}
            </G>
          );
        })}
        {props.breadcrumbs.map((b, i) => {
          const s = screenOf(b);
          return <Circle key={i} cx={s.x} cy={s.y} r={1.6} fill={colors.passed} />;
        })}
        {props.lost && you.kind === 'measured' && props.wayBack !== null && (
          <Line
            {...lineBetween(screenOf(you.at), screenOf(props.wayBack))}
            stroke={colors.lost}
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}
        {you.kind === 'measured' && (
          <G>
            <Circle
              {...centre(screenOf(you.at))}
              r={Math.max(3, (you.accuracyM / 1000) * view.scale)}
              fill={youColour}
              opacity={0.1}
              stroke={youColour}
              strokeOpacity={0.35}
            />
            <Circle {...centre(screenOf(you.at))} r={5} fill={youColour} stroke={colors.ink} strokeWidth={1.5} />
          </G>
        )}
        {you.kind === 'declared' && (
          <Circle {...centre(toScreen(atKm(route, reachedKm).plane))} r={5} fill={colors.you} stroke={colors.ink} strokeWidth={1.5} />
        )}
        {props.cursorKm !== null && <Cursor at={toScreen(atKm(route, props.cursorKm).plane)} km={props.cursorKm} />}
        <G opacity={0.8}>
          <Line x1={mapWidth - 22} y1={30} x2={mapWidth - 22} y2={12} stroke={colors.muted} strokeWidth={1.4} />
          <SvgText x={mapWidth - 22} y={42} fill={colors.muted} fontSize={9} textAnchor="middle" fontFamily={mono}>
            N
          </SvgText>
        </G>
      </Svg>
    </View>
  );
}

function Cursor({ at, km }: { at: { x: number; y: number }; km: number }) {
  return (
    <G>
      <Circle cx={at.x} cy={at.y} r={5.5} fill={colors.scrub} stroke={colors.ink} strokeWidth={1.5} />
      <SvgText x={at.x} y={at.y - 12} fill={colors.scrub} fontSize={10} textAnchor="middle" fontFamily={mono}>
        km {kmValue(km)}
      </SvgText>
    </G>
  );
}

const centre = (s: { x: number; y: number }) => ({ cx: s.x, cy: s.y });
const lineBetween = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

const pathOf = (points: { x: number; y: number }[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

type Arrow = { x: number; y: number; angle: number };

/**
 * Arrows saying which way the course is run, one every `arrowSpacing` along
 * the drawn line, each turned to its own segment. Only for the stretch ahead:
 * on an out-and-back, arrows on both passes would point both ways at once.
 */
function arrowsAlong(points: { x: number; y: number }[]): Arrow[] {
  const arrows: Arrow[] = [];
  let untilNext = arrowSpacing / 2;
  for (let i = 1; i < points.length; i++) {
    let from = points[i - 1];
    const to = points[i];
    let segment = Math.hypot(to.x - from.x, to.y - from.y);
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    while (segment > 0 && untilNext <= segment) {
      const fraction = untilNext / segment;
      from = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
      arrows.push({ ...from, angle });
      segment = Math.hypot(to.x - from.x, to.y - from.y);
      untilNext = arrowSpacing;
    }
    untilNext -= segment;
  }
  return arrows.filter((a) => a.x >= 0 && a.x <= mapWidth && a.y >= 0 && a.y <= mapHeight);
}

/** The whole course in view. */
export function fitAll(route: Route): MapView {
  const xs = route.points.map((p) => p.plane.x);
  const ys = route.points.map((p) => p.plane.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = Math.max(0.05, maxX - minX);
  const spanY = Math.max(0.05, maxY - minY);
  return {
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    scale: Math.min((mapWidth - padding * 2) / spanX, (mapHeight - padding * 2) / spanY),
  };
}

/** About 900 m across: the runner and the course line around them. */
export const fitTo = (centre: Plane): MapView => ({ centre, scale: (mapWidth - padding * 2) / 0.9 });

/** Zoom limits: from the whole course at a quarter size, to about 100 m across. */
function clampScale(route: Route, scale: number): number {
  const whole = fitAll(route).scale;
  return Math.min(Math.max(scale, whole / 4), (mapWidth - padding * 2) / 0.1);
}

/** One finger moves the map, two fingers zoom it. */
function useMapGestures(route: Route, view: MapView, onView: (v: MapView) => void) {
  const width = useRef(mapWidth);
  const latest = useRef({ view, onView });
  latest.current = { view, onView };
  const start = useRef<{ view: MapView; touches: { x: number; y: number }[] } | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          start.current = { view: latest.current.view, touches: touchesOf(e.nativeEvent.touches) };
        },
        onPanResponderMove: (e) => {
          const touches = touchesOf(e.nativeEvent.touches);
          const begin = start.current;
          if (begin === null) return;
          if (touches.length !== begin.touches.length) {
            start.current = { view: latest.current.view, touches };
            return;
          }
          const units = mapWidth / Math.max(1, width.current);
          const scale =
            touches.length >= 2
              ? clampScale(route, begin.view.scale * (spread(touches) / Math.max(1, spread(begin.touches))))
              : begin.view.scale;
          const dx = (middle(touches).x - middle(begin.touches).x) * units;
          const dy = (middle(touches).y - middle(begin.touches).y) * units;
          latest.current.onView({
            scale,
            centre: { x: begin.view.centre.x - dx / scale, y: begin.view.centre.y - dy / scale },
          });
        },
        onPanResponderRelease: () => {
          start.current = null;
        },
      }),
    [route],
  );
  return { panHandlers: responder.panHandlers, setWidth: (w: number) => (width.current = w) };
}

const touchesOf = (touches: readonly { pageX: number; pageY: number }[]) => touches.map((t) => ({ x: t.pageX, y: t.pageY }));
const middle = (ts: { x: number; y: number }[]) => ({
  x: ts.reduce((s, t) => s + t.x, 0) / ts.length,
  y: ts.reduce((s, t) => s + t.y, 0) / ts.length,
});
const spread = (ts: { x: number; y: number }[]) => (ts.length < 2 ? 1 : Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y));
