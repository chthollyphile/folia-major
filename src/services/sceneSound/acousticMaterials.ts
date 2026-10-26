import type { AcousticMaterial, RoomRequest } from './acousticsTypes';

// src/services/sceneSound/acousticMaterials.ts
// The built-in acoustic material table (scene-engine-design.md 4.5) and the step that flattens a scene's
// meshes, each with its own list of material ids, into the one table a RoomRequest carries.
// Values: absorption at Steam Audio's three bands (about 400 Hz, 2.5 kHz, 15 kHz), scattering, transmission.
// Sources as in the prototype (proto/scene-sound phonon.cjs; claude-notes/scene-acoustics-materials.md):
// published octave-band absorption, 400 Hz interpolated on a log scale between 250 and 500 Hz, 2.5 kHz
// between 2 and 4 kHz, 15 kHz taking the 4 kHz value; scattering and transmission from Steam Audio's
// presets for similar surfaces.

type Row = [number, number, number, number, number, number, number];
const material = ([a1, a2, a3, scattering, t1, t2, t3]: Row): AcousticMaterial => ({
    absorption: [a1, a2, a3],
    scattering,
    transmission: [t1, t2, t3],
});

/** What a mesh gets when it names a material the table does not have. Steam Audio's own "generic" preset. */
export const GENERIC_MATERIAL = 'generic';

export const ACOUSTIC_MATERIALS: Readonly<Record<string, AcousticMaterial>> = {
    [GENERIC_MATERIAL]: material([0.10, 0.20, 0.30, 0.05, 0.100, 0.050, 0.030]),
    carpet: material([0.11, 0.62, 0.65, 0.05, 0.020, 0.005, 0.003]), // heavy carpet glued to concrete
    plaster: material([0.12, 0.06, 0.04, 0.05, 0.056, 0.056, 0.004]), // Steam Audio preset
    wood: material([0.06, 0.06, 0.06, 0.05, 0.070, 0.014, 0.005]), // stage floor, two layers of 27 mm over air space
    'velvet-heavy': material([0.49, 0.68, 0.65, 0.30, 0.100, 0.050, 0.030]), // velour 610 g/m2 draped to half area
    'seat-upholstered': material([0.79, 0.83, 0.81, 0.60, 0.050, 0.020, 0.010]), // heavily upholstered seats, empty, per m2 of seating
    // Derived, not measured: a microperforated screen passes about 80/70/40 % of the energy at these bands
    // into the absorbent wall behind it.
    'perforated-screen': material([0.64, 0.70, 0.38, 0.10, 0.900, 0.800, 0.600]),
    'wall-absorber': material([0.81, 0.99, 0.99, 0.10, 0.050, 0.020, 0.010]), // 50 mm fabric-wrapped mineral wool (ASTM type A)
    'ceiling-absorber': material([0.66, 0.94, 0.95, 0.10, 0.050, 0.020, 0.010]), // mineral fibre tile, NRC 0.80
    'ceiling-painted': material([0.02, 0.04, 0.05, 0.05, 0.056, 0.056, 0.004]), // smooth plaster on masonry, painted
};

/** A scene's room as the scene hands it over (AcousticWorld in scenes/definition.ts). */
export interface AcousticMeshes {
    meshes: readonly {
        positions: Float32Array;
        indices: Uint32Array;
        triangleMaterials: Uint16Array;
        materials: readonly string[];
    }[];
}

/**
 * Turns each mesh's own material list into one shared table. A material id the table does not have,
 * or a triangle pointing past its mesh's list, becomes `generic`; `unknown` names what was replaced.
 */
export const flattenAcoustics = (world: AcousticMeshes): Pick<RoomRequest, 'meshes' | 'materials'> & { unknown: string[] } => {
    const ids: string[] = [];
    const unknown = new Set<string>();
    const indexOf = (id: string) => {
        const known = id in ACOUSTIC_MATERIALS ? id : GENERIC_MATERIAL;
        if (known !== id) unknown.add(id);
        const at = ids.indexOf(known);
        if (at >= 0) return at;
        ids.push(known);
        return ids.length - 1;
    };
    const meshes = world.meshes.map((mesh) => {
        const local = mesh.materials.map(indexOf);
        const triangleMaterials = Uint16Array.from(mesh.triangleMaterials, entry => local[entry] ?? indexOf(GENERIC_MATERIAL));
        return { positions: mesh.positions, indices: mesh.indices, triangleMaterials };
    });
    return { meshes, materials: ids.map(id => ACOUSTIC_MATERIALS[id]), unknown: [...unknown] };
};
