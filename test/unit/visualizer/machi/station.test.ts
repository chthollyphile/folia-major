import { describe, expect, it } from 'vitest';
import { MACHI_BASE } from '@/components/visualizer/machi/engine/geometry/plinth';
import { MACHI_TRAFFIC_CAR } from '@/components/visualizer/machi/engine/actors/traffic';
import { APRON, APRON_PROPS, CANOPY, CAR, ISLANDS, KEI_TRUCK, LOT_LAMP, MOTEL_SIGN, PUMP_CAR, PYLON, ROAD, STALLS, STATION_VIEW, TRUCK, TRUCK_SCREEN } from '@/components/visualizer/machi/scenes/station/layout';
import { resolveStationVariation } from '@/components/visualizer/machi/scenes/station/stationSeed';

// test/unit/visualizer/machi/station.test.ts
// 加油站停车场：按歌变的东西是确定的、前排至少一辆出租车（顶灯要滚歌词）；货车屏幕与出租车顶灯都朝 +z，
// 离默认镜头方向不超过 30°；车位、货车、罩棚互不重叠，都在底座里；开过的车整辆在路上、两条车道并得下两辆车；
// 路缘后面那排立牌、灯杆、轻卡不压到路，也不碰停着的车；加油区那辆车整辆在加油区上，不碰罩棚柱、加油岛和小道具。

describe('station variation', () => {
    it('is deterministic and always parks at least one taxi', () => {
        for (let index = 0; index < 300; index += 1) {
            const seed = `song-${index}`;
            const variation = resolveStationVariation(seed, 7, 4);
            expect(resolveStationVariation(seed, 7, 4)).toEqual(variation);
            expect(variation.stalls).toHaveLength(STALLS.x.length);
            expect(variation.stalls).toContain('taxi');
            expect(variation.taxiLivery).toBeLessThan(4);
            variation.carColors.forEach(color => expect(color).toBeLessThan(7));
            if (variation.hazardStall >= 0) expect(variation.stalls[variation.hazardStall]).toBe('sedan');
        }
    });
});

describe('station layout', () => {
    it('turns the truck screen and the taxi signs towards the default camera', () => {
        // 屏幕与顶灯的法线都是 +z（方位角 0），默认镜头在方位角 25°。
        expect(Math.abs(STATION_VIEW.azimuth) * 180 / Math.PI).toBeLessThanOrEqual(30);
        expect(TRUCK_SCREEN.width).toBeGreaterThan(4.4);
        expect(TRUCK_SCREEN.z).toBeGreaterThan(TRUCK.z1);
    });

    it('keeps the truck, the canopy and the parked cars apart and on the base', () => {
        const half = MACHI_BASE.half;
        const boxes = [
            { name: 'truck', x0: TRUCK.rear, x1: TRUCK.front, z0: TRUCK.z0, z1: TRUCK.z1 },
            { name: 'canopy', x0: CANOPY.x0, x1: CANOPY.x1, z0: CANOPY.z0, z1: CANOPY.z1 },
            ...STALLS.x.map((x, index) => ({ name: `stall${index}`, x0: x - CAR.width / 2, x1: x + CAR.width / 2, z0: STALLS.z - CAR.length / 2 + 0.15, z1: STALLS.z + CAR.length / 2 + 0.15 })),
        ];
        boxes.forEach(box => {
            expect(box.x0).toBeGreaterThanOrEqual(-half);
            expect(box.x1).toBeLessThanOrEqual(half);
            expect(box.z0).toBeGreaterThanOrEqual(-half);
            expect(box.z1).toBeLessThanOrEqual(half);
        });
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => {
            const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
            expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
        }));
    });

    it('fits the passing car on its lane, inside the base and off the curb', () => {
        const half = MACHI_TRAFFIC_CAR.width / 2;
        ROAD.lanes.forEach(lane => {
            expect(lane - half).toBeGreaterThan(ROAD.z0);
            expect(lane + half).toBeLessThan(Math.min(ROAD.z1, MACHI_BASE.half));
        });
        expect(ROAD.lanes[1] - ROAD.lanes[0]).toBeGreaterThan(MACHI_TRAFFIC_CAR.width);
    });

    it('keeps the row behind the curb off the road and clear of the parked cars', () => {
        const curb = ROAD.z0 - ROAD.curb;
        const stallFront = STALLS.z + 0.15 + CAR.length / 2 + 0.04;
        // 各件的 z 范围（立柱的底座转过一点，按外接框算；轻卡沿 x 停，z 方向是车宽）。
        const row = [
            { name: 'pylon', x0: PYLON.x - 0.65, x1: PYLON.x + 0.65, z0: PYLON.z - 0.4, z1: PYLON.z + 0.4 },
            { name: 'motel', x0: MOTEL_SIGN.x - 0.3, x1: MOTEL_SIGN.x + 0.3, z0: MOTEL_SIGN.z - 0.3, z1: MOTEL_SIGN.z + 0.3 },
            { name: 'lamp', x0: LOT_LAMP.x - 0.13, x1: LOT_LAMP.x + 0.13, z0: LOT_LAMP.z - 0.13, z1: LOT_LAMP.z + 0.13 },
            { name: 'kei', x0: KEI_TRUCK.x - 1.54, x1: KEI_TRUCK.x + 1.54, z0: KEI_TRUCK.z - 0.68, z1: KEI_TRUCK.z + 0.68 },
        ];
        row.forEach(item => {
            expect(item.z1, `${item.name} reaches the curb`).toBeLessThan(curb);
            STALLS.x.forEach(x => {
                const overlap = item.x0 < x + CAR.width / 2 && x - CAR.width / 2 < item.x1 && item.z0 < stallFront;
                expect(overlap, `${item.name} hits stall at ${x}`).toBe(false);
            });
        });
        row.forEach((a, i) => row.slice(i + 1).forEach(b => {
            const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
            expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
        }));
    });

    it('parks the pump car on the apron, clear of the canopy columns, the islands and the props', () => {
        // 车沿 x 停：长度加上前后保险杠，宽度加上两边后视镜。
        const halfLength = CAR.length / 2 + 0.04;
        const halfWidth = CAR.width / 2 + 0.12;
        const car = { x0: PUMP_CAR.x - halfLength, x1: PUMP_CAR.x + halfLength, z0: PUMP_CAR.z - halfWidth, z1: PUMP_CAR.z + halfWidth };
        expect(car.x0).toBeGreaterThan(APRON.x0);
        expect(car.x1).toBeLessThan(APRON.x1);
        expect(car.z0).toBeGreaterThan(APRON.z0);
        expect(car.z1).toBeLessThan(APRON.z1);
        const square = (name: string, x: number, z: number, half: number) => ({ name, x0: x - half, x1: x + half, z0: z - half, z1: z + half });
        const { airPump, bins, tires } = APRON_PROPS;
        const obstacles = [
            // 柱脚的护墩 0.5m 见方。
            ...CANOPY.columns.map(([x, z], index) => square(`column${index}`, x, z, 0.25)),
            ...ISLANDS.z.map((z, index) => ({ name: `island${index}`, x0: ISLANDS.x0, x1: ISLANDS.x1, z0: z - ISLANDS.width / 2, z1: z + ISLANDS.width / 2 })),
            // 充气机连同软管（软管从机身中心往 +x、+z 各伸出 0.3m 落地）。
            { name: 'airPump', x0: airPump.x - airPump.width / 2, x1: airPump.x + 0.32, z0: airPump.z - airPump.depth / 2, z1: airPump.z + 0.32 },
            ...bins.z.map((z, index) => square(`bin${index}`, bins.x, z, bins.size / 2)),
            square('tires', tires.x, tires.z, tires.radius),
        ];
        obstacles.forEach(box => {
            const overlap = car.x0 < box.x1 && box.x0 < car.x1 && car.z0 < box.z1 && box.z0 < car.z1;
            expect(overlap, `pump car hits ${box.name}`).toBe(false);
        });
    });
});
