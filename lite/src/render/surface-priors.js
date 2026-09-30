// Direct parameter port of blender/pill_surface.py PRESETS. Units in mm.
// Procedural priors, not measured material properties. Noise/BSDF implementations
// differ across engines; matching controls does not establish Cycles equivalence.
export const SURFACE_PRIORS = {
  chalky: { source: 'chalky_uncoated', roughness: .86, diffuse: .65, specularIOR: .23, grain: .110, relief: .023, fine: .024, fineRelief: .002, pores: .08, pore: .125, poreDepth: .020, mottling: .065, sss: .025 },
  matte_film: { source: 'matte_film', roughness: .66, diffuse: .30, specularIOR: .34, grain: .145, relief: .012, fine: .035, fineRelief: .0014, pores: .015, pore: .085, poreDepth: .004, mottling: .025, sss: .02 },
  satin_film: { source: 'satin_film', roughness: .42, diffuse: .15, specularIOR: .42, grain: .165, relief: .0065, fine: .030, fineRelief: .00035, pores: .015, pore: .090, poreDepth: .002, mottling: .012, sss: .025 },
  gelatin_shell: { source: 'gelatin_shell', roughness: .23, diffuse: .07, specularIOR: .48, grain: .230, relief: .0009, fine: .038, fineRelief: .0002, pores: 0, pore: .100, poreDepth: 0, mottling: .009, sss: .045 },
  softgel_shell: { source: 'softgel_shell', roughness: .09, diffuse: .03, specularIOR: .50, grain: .280, relief: .00065, fine: .035, fineRelief: .0001, pores: 0, pore: .100, poreDepth: 0, mottling: .005, sss: .02 },
};
export function surfaceParameters(spec) {
  const name = spec.kind === 'capsule' ? 'gelatin_shell' : spec.kind === 'softgel' ? 'softgel_shell' : spec.finish;
  const f = SURFACE_PRIORS[name] ?? SURFACE_PRIORS.chalky, wear = Math.max(0, spec.wear ?? 0), texture = spec.texture ?? 1;
  return { ...f,
    roughness: Math.min(.98, (spec.roughness ?? f.roughness) + (spec.roughnessShift ?? 0) + .1 * wear),
    grain: f.grain * (spec.grainScale ?? 1), relief: f.relief * texture * (1 + 1.5 * wear),
    fineRelief: f.fineRelief * texture, poreDepth: f.poreDepth * texture * (1 + wear),
    pores: spec.pores ?? f.pores, mottling: f.mottling * (spec.mottling ?? 1), wear,
  };
}
