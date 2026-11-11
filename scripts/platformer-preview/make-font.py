"""Build the game's original 5×7 pixel display font. Requires fontTools only."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
patterns = {
'A':'01110 11011 11011 11111 11011 11011 11011',
'B':'11110 11011 11011 11110 11011 11011 11110',
'C':'01111 11000 11000 11000 11000 11000 01111',
'D':'11110 11011 11011 11011 11011 11011 11110',
'E':'11111 11000 11000 11110 11000 11000 11111',
'F':'11111 11000 11000 11110 11000 11000 11000',
'G':'01111 11000 11000 11011 11011 11011 01111',
'H':'11011 11011 11011 11111 11011 11011 11011',
'I':'11111 00100 00100 00100 00100 00100 11111',
'J':'00111 00011 00011 00011 11011 11011 01110',
'K':'11011 11011 11110 11100 11110 11011 11011',
'L':'11000 11000 11000 11000 11000 11000 11111',
'M':'10001 11011 11111 11111 11011 11011 11011',
'N':'11001 11101 11101 11111 11011 11011 11001',
'O':'01110 11011 11011 11011 11011 11011 01110',
'P':'11110 11011 11011 11110 11000 11000 11000',
'Q':'01110 11011 11011 11011 11111 01110 00011',
'R':'11110 11011 11011 11110 11110 11011 11011',
'S':'01111 11000 11000 01110 00011 00011 11110',
'T':'11111 00100 00100 00100 00100 00100 00100',
'U':'11011 11011 11011 11011 11011 11011 01110',
'V':'11011 11011 11011 11011 11011 01010 00100',
'W':'11011 11011 11011 11111 11111 11011 10001',
'X':'11011 11011 01010 00100 01010 11011 11011',
'Y':'11011 11011 11011 01110 00100 00100 00100',
'Z':'11111 00011 00110 01100 11000 11000 11111',
'0':'01110 11011 11011 11011 11011 11011 01110',
'1':'00100 01100 00100 00100 00100 00100 01110',
'2':'01110 11011 00011 00110 01100 11000 11111',
'3':'11110 00011 00011 01110 00011 00011 11110',
'4':'11011 11011 11011 11111 00011 00011 00011',
'5':'11111 11000 11000 11110 00011 00011 11110',
'6':'01110 11000 11000 11110 11011 11011 01110',
'7':'11111 00011 00011 00110 00110 01100 01100',
'8':'01110 11011 11011 01110 11011 11011 01110',
'9':'01110 11011 11011 01111 00011 00011 01110',
'!':'00100 00100 00100 00100 00100 00000 00100',
'?':'01110 11011 00011 00110 00100 00000 00100',
'-':'00000 00000 00000 11111 00000 00000 00000',
'.':'00000 00000 00000 00000 00000 00110 00110',
' ':'00000 00000 00000 00000 00000 00000 00000',
}
order=['.notdef']+[f'g{ord(c)}' for c in patterns]
font=FontBuilder(1000,isTTF=True);font.setupGlyphOrder(order)
glyphs={};metrics={}
for c in ['.notdef',*patterns]:
    pen=TTGlyphPen(None)
    for y,row in enumerate(patterns.get(c,patterns['?']).split()):
        for x,on in enumerate(row):
            if on=='1':
                left=x*100;bottom=(6-y)*100
                pen.moveTo((left,bottom));pen.lineTo((left,bottom+100));pen.lineTo((left+100,bottom+100));pen.lineTo((left+100,bottom));pen.closePath()
    name=c if c=='.notdef' else f'g{ord(c)}';glyphs[name]=pen.glyph();metrics[name]=(600,0)
font.setupGlyf(glyphs);font.setupHorizontalMetrics(metrics);font.setupHorizontalHeader(ascent=800,descent=-200)
cmap={ord(c):f'g{ord(c)}' for c in patterns};cmap.update({ord(c.lower()):f'g{ord(c)}' for c in patterns if c.isalpha()})
font.setupCharacterMap(cmap);font.setupNameTable({'familyName':'Huddle Pixel','styleName':'Regular','uniqueFontIdentifier':'HuddlePixel1','fullName':'Huddle Pixel','psName':'HuddlePixel-Regular'});font.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200);font.setupPost();font.setupMaxp()
font.save(Path(__file__).resolve().parents[2]/'src/features/games/platformer/pixel.ttf')
