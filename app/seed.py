"""Paint catalogue seeding.

The colours below are the real Berger Paints Nigeria range, transcribed from the
company's own published colour brochure:

    https://bergerpaintsnig.com/wp-content/uploads/2020/08/BERGER-COLOUR-BROCHURE-1.pdf

Names and the Berger reference codes (NF-R06, 2001-P, …) are exactly as printed.
The hex values are sampled from the brochure's printed swatches, so they are the
brochure's CMYK rendering of each colour, not a measurement of the paint itself —
the brochure says as much on every page: "We have represented the colours as
precisely as printing process would allow." Treat them as close approximations
and verify against a physical fan deck before anyone buys paint from them.

Finish is deliberately left unset: it belongs to the product line (Luxol,
Superstar, …), not to the colour, and the brochure does not pair the two.
"""

from sqlmodel import Session, select, text

from app.core.database import engine
from app.models.paint_color import PaintColor

BRAND = "Berger Paints Nigeria"

# (name, berger_code, hex) grouped by the brochure's own colour families.
BERGER_NIGERIA = [
    # --- Reds (brochure p.02) ---
    ("Mexican Shore", "3302-P", "#F9E7DD"),
    ("Cool Cream", "NF-R01", "#F9EBE2"),
    ("Liatic Red", "NF-R02", "#F1E7E8"),
    ("Pink Petunia", "2001-P", "#F5E6E6"),
    ("Graceful", "2214-T", "#FDC7B9"),
    ("Peach Dream", "2213-P", "#FECCB9"),
    ("Crystal Pink", "3122-P", "#E9C3D5"),
    ("Rose Maiden", "2144-T", "#F1BEC7"),
    ("Spicetone", "2276-D", "#F5B8A2"),
    ("Clementine", "2195-T", "#FDB9AA"),
    ("Cherry Frost", "2114-D", "#ECA8BA"),
    ("Rosemonde", "2115-D", "#E795AA"),
    ("Testy Brown", "NF-R03", "#E7876B"),
    ("Deep Tangy", "NF-R04", "#E3707D"),
    ("Nice Brown", "NF-R05", "#B54045"),
    ("Mandalay", "2188-A", "#CD6170"),
    ("Naij Red", "NF-R06", "#CF403F"),
    ("Salmon Orange", "NF-R07", "#DE4F42"),
    ("Chic Chic", "NF-R08", "#A64040"),
    ("Dark Spice", "NF-R09", "#994E49"),

    # --- Oranges (p.04) ---
    ("Apricot Blush", "2242-P", "#FBDAC3"),
    ("Pale Bittersweet", "2215-D", "#F5A581"),
    ("Sweet Mony", "NF-O01", "#F19E6F"),
    ("Felicity", "3181-P", "#F9ECDE"),
    ("Lucinda", "2187-A", "#E87E58"),
    ("Sweet Tangerine", "2245-D", "#F9B686"),
    ("Spice Tint", "2264-T", "#F7D0AA"),
    ("Isabella", "2165-D", "#FAA595"),
    ("Pale Lily", "2225-T", "#F7C3A7"),
    ("Bright Idea", "2247-D", "#EC8E57"),
    ("Osage Orange", "2186-D", "#F5A581"),
    ("Razzmatazz", "2167-A", "#EB725C"),
    ("Luwina", "NF-O02", "#DD6F57"),
    ("Brick Orange", "NF-O03", "#E76E44"),
    ("Terra Red", "NF-O04", "#E35D40"),
    ("Fall Finale", "2218-A", "#C25744"),
    ("Mahogany", "2158-A", "#A65340"),
    ("Red Finch", "2156-A", "#BC735B"),
    ("Canyon Brown", "2208-A", "#9A5745"),

    # --- Yellows (p.06) ---
    ("Baguette", "3423-P", "#F9F2DB"),
    ("Chantilly Lace", "2531-P", "#FAF4DE"),
    ("Pale Yellow", "NF-Y01", "#F6F1D5"),
    ("Inner Lime", "NF-Y02", "#F2ECD0"),
    ("Flowery Cream", "NF-Y03", "#F7ECBD"),
    ("Yellow Tint", "2482-P", "#FBEFC2"),
    ("Swiss Cream", "NF-Y04", "#FBF2D9"),
    ("Utopia", "2533-P", "#F5E8B5"),
    ("Yellow Finch", "2535-D", "#FDECA8"),
    ("Moonbeam", "2483-T", "#FEEBB5"),
    ("Gold Feather", "2485-D", "#FEE793"),
    ("Feverfew", "2486-A", "#ECD986"),
    ("Golden Yellow", "NF-Y05", "#FFD066"),
    ("Yarrow", "2517-D", "#FDDE65"),
    ("Tangery Flower", "NF-Y06", "#F2C446"),
    ("Gold Plate", "2487-A", "#DBC45B"),
    ("Marigold", "2498-A", "#FFC720"),
    ("Yellow Flame", "2497-D", "#FAD04E"),
    ("Monaco", "2408-A", "#ECB12E"),
    ("Roman Gold", "2488-D", "#BEA340"),

    # --- Greens (p.08) ---
    ("Organza", "2631-P", "#F1F2D9"),
    ("Chickory Tint", "2643-P", "#E1ECD0"),
    ("Mini Green", "NF-G01", "#E7EBCC"),
    ("Molly", "2642-P", "#E4F1E1"),
    ("Bitters", "2562-P", "#E2EBA5"),
    ("Glycerine", "2634-D", "#DAE8B5"),
    ("Misty Green", "2622-P", "#DAE3B0"),
    ("Light Salad", "NF-G02", "#BCE6BA"),
    ("Lemon Lime", "2566-D", "#DDE385"),
    ("Willow Bay", "2625-D", "#C2DE91"),
    ("Pennywort", "2594-D", "#BECD86"),
    ("Bonnie Brae", "2705-D", "#75B490"),
    ("Lime Pop", "2567-D", "#CCD453"),
    ("Pea Pod", "2626-D", "#A5CC66"),
    ("Morning Green", "2648-A", "#5E873A"),
    ("Pleasant Grove", "2707-A", "#54946A"),
    ("Antichoke Heart", "2596-A", "#A8BC3A"),
    ("Bibb Lettuce", "2627-D", "#9DC761"),
    ("Rich Green", "2708-A", "#346A4D"),
    ("Green Jeans", "2718-A", "#526657"),

    # --- Blues (p.10) ---
    ("Niagra", "2912-P", "#C1D5E4"),
    ("Yukon Morn", "2911-P", "#DFE9EC"),
    ("Pathfinder", "2882-P", "#AFD8E7"),
    ("Pale Sky", "2851-P", "#E6F0EC"),
    ("Marble Falls", "2853-P", "#B0DBE6"),
    ("Summer Breeze", "3562-P", "#B4CFE3"),
    ("Diana", "2935-T", "#7DBFE2"),
    ("Ash Blue", "NF-B01", "#C1CCD9"),
    ("Fond Du Lac", "2865-D", "#60B8D4"),
    ("Gainsborough", "2966-D", "#78A7D0"),
    ("Blue Thunder", "2968-A", "#546BA6"),
    ("Lake Blue", "NF-B02", "#8FA5C4"),
    ("Aruba Wave", "2867-D", "#0997B6"),
    ("Coney Island", "2937-D", "#0080B9"),
    ("Lizzy Blue", "NF-B03", "#4475A7"),
    ("Ally Blue", "NF-B04", "#667DA0"),
    ("Meeky Blue", "NF-B05", "#0D5989"),
    ("Blue Bonnet", "2938-A", "#255895"),
    ("Boston Bay", "2918-A", "#344669"),
    ("Night Sky", "3568-A", "#37404F"),

    # --- Indigos (p.12) ---
    ("Easy Beige", "3222-P", "#F2E3E2"),
    ("Baby's Cheeks", "3091-P", "#F1E6E8"),
    ("Blushing Bride", "2031-P", "#F2E2E3"),
    ("Baby Rose", "2033-T", "#E6B9CC"),
    ("Arapaho", "3164-P", "#DEB9BA"),
    ("Lucia", "3142-P", "#E3BEC8"),
    ("Pink Praise", "NF-I01", "#DA93B0"),
    ("Light Shadow", "NF-I02", "#D6B0B0"),
    ("Angelina", "3124-D", "#CC94B4"),
    ("Maui", "2035-D", "#CC99AB"),
    ("Festivity", "2047-A", "#C26686"),
    ("Victorian Rose", "2046-D", "#D586A6"),
    ("Ashen Plum", "3127-A", "#B36F93"),
    ("Melissa", "2036-A", "#A76979"),
    ("Mid Stream", "NF-I03", "#BE869C"),
    ("Rosy Red", "NF-I04", "#9A4659"),
    ("Vick Berry", "NF-I05", "#673D45"),
    ("Ashes of Roses", "2038-A", "#72464F"),
    ("Antique Rose", "2037-A", "#985B6D"),

    # --- Violets (p.14) ---
    ("Anty Quartz", "NF-V01", "#D9D9E3"),
    ("Flowering Plum", "3672-P", "#E4DEE7"),
    ("Violet Splendour", "3092-P", "#EFE3E8"),
    ("Sweet Violet", "3673-P", "#E7DEE7"),
    ("Riv Blossom", "NF-V02", "#9898BA"),
    ("Bet Talc", "NF-V03", "#D3C8E1"),
    ("Pale Heliotrope", "3103-P", "#DECCE2"),
    ("Cool Purp", "NF-V04", "#DDCCE2"),
    ("Grape Purple", "NF-V05", "#6A6A94"),
    ("Meadow Violet", "3086-D", "#B0A5CD"),
    ("Bloom Lilac", "NF-V06", "#C4ABCC"),
    ("Scot Lilac", "NF-V07", "#CDB4D5"),
    ("Blueberry Hill", "3068-A", "#495086"),
    ("Wild Violet", "3108-A", "#7D6DA2"),
    ("Hibiscus", "3106-D", "#AF8EBD"),
    ("Astry Purple", "NF-V08", "#8F6AA0"),
    ("Deep Violet", "NF-V09", "#5E456B"),
    ("Wilderness Flower", "NF-V10", "#654977"),
    ("Brown Plum", "NF-V11", "#86577B"),
    ("Crushed Grape", "3678-A", "#46406B"),

    # --- Neutrals (p.16) ---
    ("Cilic Cream", "NF-N01", "#F4ECDE"),
    ("Danny Grey", "NF-N02", "#E7E4D6"),
    ("May Pearl", "3601-P", "#F5F1E6"),
    ("Silver Bay", "3602-P", "#E9E8E6"),
    ("Rose Cream", "NF-N03", "#F6E7DB"),
    ("Birch Bark", "3613-P", "#DEDDD6"),
    ("Clean Linen", "NF-N04", "#F1EDE6"),
    ("Silver Shadow", "3593-P", "#E7ECE7"),
    ("Sandy Pail", "NF-N05", "#F5E9E3"),
    ("Dusty Gray", "3533-P", "#C7CBCC"),
    ("Alaska Grey", "NF-N06", "#E3E1E4"),
    ("Posh White", "NF-N07", "#D9D8D4"),
    ("Tushcopa", "NF-N08", "#FAE1C7"),
    ("Slight Ash", "NF-N09", "#E7E6E2"),
    ("Silver Bell", "3642-P", "#E3E3E6"),
    ("Kanatil", "NF-N10", "#D4D5D0"),
    ("Nude Peach", "NF-N11", "#F7DEB9"),
    ("Driftwood", "3262-P", "#DED9D8"),
    ("Robin Cotton", "NF-N12", "#D9D9D8"),
    ("Galacia", "3633-P", "#CCCCCB"),
]


def ensure_code_column() -> None:
    """Add paintcolor.code if it predates this change.

    SQLModel's create_all only creates missing tables, never new columns on an
    existing one, and the project has no migration tool — so this small guard
    stands in for one.
    """
    with engine.begin() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(paintcolor)"))}
        if "code" not in columns:
            conn.execute(text("ALTER TABLE paintcolor ADD COLUMN code VARCHAR"))
            print("Added paintcolor.code column.")


def seed_paint_colors() -> None:
    """Insert any colours not already present, matched on brand + code."""
    ensure_code_column()

    with Session(engine) as session:
        existing = {
            (c.brand, c.code) for c in session.exec(select(PaintColor)).all() if c.code
        }
        added = 0
        for name, code, hex_code in BERGER_NIGERIA:
            if (BRAND, code) in existing:
                continue
            session.add(PaintColor(name=name, hex_code=hex_code, brand=BRAND, code=code))
            existing.add((BRAND, code))
            added += 1
        session.commit()

    print(f"Seeded {added} Berger Paints Nigeria colours ({len(BERGER_NIGERIA) - added} already present).")


if __name__ == "__main__":
    seed_paint_colors()
