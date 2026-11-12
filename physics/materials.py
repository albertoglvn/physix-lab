"""Named isotropic material presets (SI units).

Values are representative room-temperature handbook properties for quick estimates. Use a
``custom`` material with supplier data for design decisions.
"""

from __future__ import annotations

from physics.case import Material

MATERIALS: dict[str, Material] = {
    "steel": Material(young=210e9, poisson=0.30, name="steel"),
    "stainless_304": Material(young=193e9, poisson=0.29, name="stainless_304"),
    "aluminium_6061": Material(young=68.9e9, poisson=0.33, name="aluminium_6061"),
    "titanium_ti6al4v": Material(young=113.8e9, poisson=0.342, name="titanium_ti6al4v"),
    "pmma": Material(young=3.2e9, poisson=0.37, name="pmma"),
}

# Representative tensile yield strength in Pa, used only for an indicative safety factor.
YIELD_STRENGTH: dict[str, float] = {
    "steel": 250e6,
    "stainless_304": 215e6,
    "aluminium_6061": 276e6,
    "titanium_ti6al4v": 880e6,
    "pmma": 70e6,
}
