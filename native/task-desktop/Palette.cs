// Colors mirror the harness's design tokens so every Win-Pilot surface belongs to
// the same product as the panel that opens it. Values are transcribed from the
// harness palette rather than picked by eye: brand-primary resolves to
// neutral-bluish-1000 (a near black), and the blue ramp is reserved for accents.

// This lives outside Program.cs because the native test projects compile the
// window sources without the host entry point, and the palette must resolve there
// too.
static class Palette
{
    internal static readonly System.Drawing.Color Paper     = System.Drawing.Color.FromArgb(0xFF,0xFF,0xFF); // warm studio surface
    internal static readonly System.Drawing.Color PaperTile = System.Drawing.Color.FromArgb(0xF6,0xF5,0xF1); // warm stone subtle surface
    internal static readonly System.Drawing.Color Ink       = System.Drawing.Color.FromArgb(0x1C,0x1B,0x18); // warm charcoal primary
    internal static readonly System.Drawing.Color InkSoft   = System.Drawing.Color.FromArgb(0x6B,0x67,0x5E); // warm stone secondary
    internal static readonly System.Drawing.Color InkFaint  = System.Drawing.Color.FromArgb(0x9C,0x9A,0x92); // warm stone tertiary
    internal static readonly System.Drawing.Color Line      = System.Drawing.Color.FromArgb(0xE7,0xE5,0xDE); // warm stone border
    internal static readonly System.Drawing.Color LineSoft  = System.Drawing.Color.FromArgb(0xF0,0xEF,0xEA); // warm stone hairline
    // Single cobalt accent + amber for active manual takeover dot.
    internal static readonly System.Drawing.Color Accent    = System.Drawing.Color.FromArgb(0x3B,0x6E,0xF6);
    internal static readonly System.Drawing.Color Amber     = System.Drawing.Color.FromArgb(0xD9,0x77,0x06);
    internal static readonly System.Drawing.Color Hover     = System.Drawing.Color.FromArgb(0xF2,0xF1,0xEC);
    internal static readonly System.Drawing.Color Danger    = System.Drawing.Color.FromArgb(0xDC,0x26,0x26);
    internal static readonly System.Drawing.Color Shadow    = System.Drawing.Color.FromArgb(0x1A,0x1C,0x1B,0x18);
}
