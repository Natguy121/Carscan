// Side-profile silhouettes, drawn per body style. Undiscovered cars show only
// their silhouette, so the shape is the one clue you get.

const SHAPES = {
  sedan: { body: 'M8,60 L12,46 L38,42 L62,26 L128,26 L152,42 L186,46 L192,60 Z', wheels: [52, 150] },
  coupe: { body: 'M8,60 L12,44 L40,40 L74,22 L112,22 L160,42 L188,48 L192,60 Z', wheels: [52, 150] },
  convertible: { body: 'M8,60 L12,44 L38,40 L66,30 L128,30 L156,44 L186,48 L192,60 Z', wheels: [52, 150] },
  hatchback: { body: 'M18,60 L22,44 L44,40 L70,22 L128,22 L152,40 L158,48 L160,60 Z', wheels: [56, 138] },
  wagon: { body: 'M8,60 L12,44 L36,40 L62,22 L156,22 L176,40 L188,44 L192,60 Z', wheels: [52, 152] },
  suv: { body: 'M10,60 L12,40 L34,36 L50,16 L150,16 L168,36 L188,40 L192,60 Z', wheels: [52, 152] },
  pickup: { body: 'M8,60 L10,44 L28,40 L44,18 L96,18 L102,40 L190,40 L192,60 Z', wheels: [50, 154] },
  van: { body: 'M10,60 L12,26 L26,14 L170,14 L184,30 L190,42 L192,60 Z', wheels: [52, 152] },
  minivan: { body: 'M10,60 L12,36 L30,20 L68,14 L150,16 L172,34 L190,42 L192,60 Z', wheels: [52, 152] },
};

/**
 * @param {string} body one of the keys of BODIES
 * @param {{fill?:string, className?:string}} opts
 */
export function silhouette(body, { fill = 'currentColor', className = '' } = {}) {
  const shape = SHAPES[body] || SHAPES.sedan;
  const wheels = shape.wheels
    .map(
      (cx) =>
        `<circle cx="${cx}" cy="62" r="13" fill="${fill}"/><circle cx="${cx}" cy="62" r="5.5" fill="rgba(0,0,0,.45)"/>`,
    )
    .join('');
  return `<svg class="${className}" viewBox="0 0 200 80" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    <path d="${shape.body}" fill="${fill}"/>${wheels}
  </svg>`;
}
