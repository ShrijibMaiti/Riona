"""
Builds Riona_Project_Report.pdf from Riona_Project_Report.md and the screenshots in docs/screenshots.

Formatting (institutional report): A4, 1-inch margins, Times New Roman, black text, justified body at 12 pt with
1.5 line spacing; main title 16 pt bold; chapter headings 14 pt bold; level-2 headings 12 pt bold; level-3 headings
12 pt bold italic; tables 10.5 pt; page numbers bottom centre. Code and diagrams use Consolas, since box-drawing
diagrams need a fixed-width face.

Run from docs/:  python build_report.py
"""
import os
import re
import tempfile

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping
from reportlab.platypus import (BaseDocTemplate, Frame, Image, KeepTogether, NextPageTemplate, PageBreak,
                                PageTemplate, Paragraph, Preformatted, Spacer, Table, TableStyle, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'Riona_Project_Report.md')
OUT = os.path.join(HERE, 'Riona_Project_Report.pdf')
SHOTS = os.path.join(HERE, 'screenshots')

# ---------------------------------------------------------------- fonts
F = r'C:\Windows\Fonts'
pdfmetrics.registerFont(TTFont('TNR', os.path.join(F, 'times.ttf')))
pdfmetrics.registerFont(TTFont('TNR-B', os.path.join(F, 'timesbd.ttf')))
pdfmetrics.registerFont(TTFont('TNR-I', os.path.join(F, 'timesi.ttf')))
pdfmetrics.registerFont(TTFont('TNR-BI', os.path.join(F, 'timesbi.ttf')))
pdfmetrics.registerFont(TTFont('Mono', os.path.join(F, 'consola.ttf')))
addMapping('TNR', 0, 0, 'TNR'); addMapping('TNR', 1, 0, 'TNR-B'); addMapping('TNR', 0, 1, 'TNR-I'); addMapping('TNR', 1, 1, 'TNR-BI')

BLACK = colors.black
LEAD = 18  # 12 pt at 1.5 line spacing
S = {
    'body': ParagraphStyle('body', fontName='TNR', fontSize=12, leading=LEAD, alignment=TA_JUSTIFY, textColor=BLACK, spaceAfter=8),
    'bullet': ParagraphStyle('bullet', fontName='TNR', fontSize=12, leading=LEAD, alignment=TA_JUSTIFY, textColor=BLACK, leftIndent=22, bulletIndent=8, spaceAfter=3),
    'bullet2': ParagraphStyle('bullet2', fontName='TNR', fontSize=12, leading=LEAD, alignment=TA_JUSTIFY, textColor=BLACK, leftIndent=44, bulletIndent=30, spaceAfter=3),
    'body_left': ParagraphStyle('body_left', fontName='TNR', fontSize=12, leading=LEAD, alignment=TA_LEFT, textColor=BLACK, spaceAfter=8),
    'bullet_left': ParagraphStyle('bullet_left', fontName='TNR', fontSize=12, leading=LEAD, alignment=TA_LEFT, textColor=BLACK, leftIndent=22, bulletIndent=0, spaceAfter=3),
    'h1': ParagraphStyle('h1', fontName='TNR-B', fontSize=14, leading=20, alignment=TA_LEFT, textColor=BLACK, spaceBefore=0, spaceAfter=14),
    'h2': ParagraphStyle('h2', fontName='TNR-B', fontSize=12, leading=LEAD, alignment=TA_LEFT, textColor=BLACK, spaceBefore=10, spaceAfter=6, keepWithNext=1),
    'h3': ParagraphStyle('h3', fontName='TNR-BI', fontSize=12, leading=LEAD, alignment=TA_LEFT, textColor=BLACK, spaceBefore=8, spaceAfter=4, keepWithNext=1),
    'cell': ParagraphStyle('cell', fontName='TNR', fontSize=10.5, leading=13.5, alignment=TA_LEFT, textColor=BLACK),
    'cellh': ParagraphStyle('cellh', fontName='TNR-B', fontSize=10.5, leading=13.5, alignment=TA_LEFT, textColor=BLACK),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=8.6, leading=10.6, textColor=BLACK, leftIndent=10),
    'caption': ParagraphStyle('caption', fontName='TNR-I', fontSize=10.5, leading=14, alignment=TA_CENTER, textColor=BLACK, spaceBefore=4, spaceAfter=14),
    'toc0': ParagraphStyle('toc0', fontName='TNR-B', fontSize=12, leading=LEAD, textColor=BLACK),
    'toc1': ParagraphStyle('toc1', fontName='TNR', fontSize=12, leading=LEAD, leftIndent=22, textColor=BLACK),
    'tp': ParagraphStyle('tp', fontName='TNR', fontSize=12, leading=LEAD, alignment=TA_CENTER, textColor=BLACK),
    'tpb': ParagraphStyle('tpb', fontName='TNR-B', fontSize=12, leading=LEAD, alignment=TA_CENTER, textColor=BLACK),
    'tptitle': ParagraphStyle('tptitle', fontName='TNR-B', fontSize=16, leading=24, alignment=TA_CENTER, textColor=BLACK),
}


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def inline(s):
    """Markdown inline marks to reportlab markup: code, bold, italic."""
    parts = re.split(r'(`[^`]+`)', s)
    out = []
    for p in parts:
        if p.startswith('`') and p.endswith('`') and len(p) > 1:
            out.append('<font name="Mono" size="10.5">' + esc(p[1:-1]) + '</font>')
            continue
        p = esc(p)
        p = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', p)
        p = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<i>\1</i>', p)
        out.append(p)
    return ''.join(out)


# ---------------------------------------------------------------- document with a table of contents
class Doc(BaseDocTemplate):
    def __init__(self, path, **kw):
        super().__init__(path, pagesize=A4, leftMargin=inch, rightMargin=inch, topMargin=inch, bottomMargin=inch,
                         title='Riona — Software Project Report', author='Shrijib Maiti', subject='B.Tech software project report', **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='f', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id='title', frames=[frame]), PageTemplate(id='body', frames=[frame], onPage=self.number)])

    @staticmethod
    def number(c, d):
        c.saveState(); c.setFont('TNR', 11); c.setFillColor(BLACK)
        c.drawCentredString(A4[0] / 2, 0.55 * inch, str(d.page))
        c.restoreState()

    def afterFlowable(self, f):
        lvl = getattr(f, 'toc_level', None)
        if lvl is not None:
            key = 'h%d' % id(f)
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.toc_text, key, level=lvl, closed=lvl > 0)
            self.notify('TOCEntry', (lvl, f.toc_text, self.page, key))


def heading(text, style, level):
    p = Paragraph(inline(text), S[style])
    p.toc_level = level
    p.toc_text = re.sub(r'[*`]', '', text)
    return p


# ---------------------------------------------------------------- tables
def table(rows):
    header, body = rows[0], rows[1:]
    ncol = len(header)
    width = A4[0] - 2 * inch
    # Column widths from content length, bounded so short columns stay readable.
    # Every column is at least as wide as its longest word (so nothing breaks mid-word); the rest of the width goes
    # to the columns with the most text.
    from reportlab.pdfbase.pdfmetrics import stringWidth
    def plain(c):
        return re.sub(r'[*`]', '', c)
    mins, mass = [], []
    for i in range(ncol):
        col = [plain(r[i]) if i < len(r) else '' for r in rows]
        words = [w for c in col for w in c.split()] or ['']
        mins.append(max(stringWidth(w, 'TNR-B', 10.5) for w in words) + 12)
        mass.append(sum(len(c) for c in col) + 1)
    base = sum(mins)
    if base >= width:
        cw = [width * m / base for m in mins]
    else:
        extra = width - base
        want = [max(0.0, m) for m in mass]
        cw = [mins[i] + extra * want[i] / sum(want) for i in range(ncol)]
    data = [[Paragraph(inline(c), S['cellh']) for c in header]]
    for r in body:
        r = r + [''] * (ncol - len(r))
        data.append([Paragraph(inline(c), S['cell']) for c in r[:ncol]])
    t = Table(data, colWidths=cw, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, BLACK),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#EDEDED')),
    ]))
    return [t, Spacer(1, 12)]


# ---------------------------------------------------------------- screenshots (Chapter 12)
SECTIONS = [
    ('Landing Page', 'The public marketing page introducing the system.', [('landing_page', '')]),
    ('Login Page', 'Email and password, with Google and Microsoft sign-in.', [('login_page', '')]),
    ('Administrator Dashboard', 'Summary metrics, the analytics blocks and items needing attention.', [('admin_dashboard', '')]),
    ('Employee Dashboard', 'The self-service view, showing how the same route differs by role.', [('employee_dashboard', '')]),
    ('People Hub', 'The departure-lounge pattern of metrics, module cards and an attention list.', [('people_hub', '')]),
    ('Employee Directory', 'The standard module page with filter bar and data table.', [('employee_directory', '')]),
    ('Compensation Tab with Salary Ledger', 'The date selector and the corrected-versus-paid toggle. July 2026 lies inside a correction window, so the two views differ.',
     [('compensation_ledger_corrected', 'as corrected'), ('compensation_ledger_as_paid', 'as paid at the time')]),
    ('New Invoice Builder', 'Timesheet selection with live totals and the margin panel.', [('new_invoice_builder', '')]),
    ('Profitability View', 'Clients sorted by margin, lowest first, with rows expanded to projects and people.', [('profitability', '')]),
    ('Weekly Timesheet Grid', 'Daily columns, billable toggles, row and column totals.', [('weekly_timesheet', '')]),
    ('Approval Workflow Builder', "The visual canvas, with an approver step selected and its SLA setting shown.", [('workflow_builder', '')]),
    ('Approvals Queue', 'Requests waiting on the signed-in person.', [('approvals_queue', '')]),
    ('Audit Log', 'Entries with before-and-after field differences.', [('audit_log', 'list'), ('audit_log_differences', 'with differences opened')]),
    ('Admin › Users', 'Inviting a user.', [('admin_users', 'user list'), ('admin_users_invite', 'invite form')]),
    ('Client Portal', 'The restricted view, including an invoice with the Pay button.',
     [('client_portal_projects', 'projects'), ('client_portal_invoices', 'invoices'), ('client_portal_invoice', 'an invoice with the Pay button'), ('client_portal_pay_dialog', 'the payment dialog')]),
    ('Mobile View at 390 px', 'A table rendered as stacked cards.', [('mobile_stacked_cards', '')]),
]

TMP = tempfile.mkdtemp(prefix='riona-report-')


def jpeg(path):
    """Screenshots go into the PDF as high-quality JPEG, which keeps the file a sensible size."""
    out = os.path.join(TMP, os.path.splitext(os.path.basename(path))[0] + '.jpg')
    if not os.path.exists(out):
        PILImage.open(path).convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
    return out


def files_for(prefix):
    rx = re.compile('^' + re.escape(prefix) + r'_(\d+)\.png$')
    fs = [(int(m.group(1)), f) for f in os.listdir(SHOTS) for m in [rx.match(f)] if m]
    return [os.path.join(SHOTS, f) for _, f in sorted(fs)]


def framed(img_path, w, h):
    im = Image(jpeg(img_path), width=w, height=h)
    t = Table([[im]], colWidths=[w + 1], rowHeights=[h + 1])
    t.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#808080')), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                           ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
    return t


def screenshots():
    flow = []
    width = A4[0] - 2 * inch
    total = 0
    for si, (title, desc, groups) in enumerate(SECTIONS, start=1):
        flow.append(CondPageBreak(4.2 * inch))
        flow.append(heading('12.%d %s' % (si, title), 'h2', 1))
        flow.append(Paragraph(inline(desc), S['body']))
        letter = 0
        for prefix, label in groups:
            files = files_for(prefix)
            n = len(files)
            portrait = files and PILImage.open(files[0]).size[1] > PILImage.open(files[0]).size[0]
            if portrait:
                # Phone screenshots: two side by side.
                pw = (width - 24) / 2
                for k in range(0, n, 2):
                    cells, caps = [], []
                    for j, f in enumerate(files[k:k + 2]):
                        iw, ih = PILImage.open(f).size
                        cells.append(framed(f, pw, pw * ih / iw))
                        caps.append(Paragraph('Figure 12.%d(%s): %s, part %d of %d' % (si, chr(97 + letter), title, k + j + 1, n), S['caption']))
                        letter += 1
                    while len(cells) < 2:
                        cells.append(''); caps.append('')
                    t = Table([cells, caps], colWidths=[width / 2] * 2)
                    t.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER'), ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
                    flow.append(t)
                total += n
                continue
            for k, f in enumerate(files):
                iw, ih = PILImage.open(f).size
                h = width * ih / iw
                what = title + (', ' + label if label else '')
                part = (', part %d of %d' % (k + 1, n)) if n > 1 else ''
                cap = Paragraph('Figure 12.%d(%s): %s%s' % (si, chr(97 + letter) if letter < 26 else str(letter + 1), what, part), S['caption'])
                flow.append(KeepTogether([framed(f, width, h), cap]))
                letter += 1
                total += 1
    print('screenshots placed:', total)
    return flow


# ---------------------------------------------------------------- markdown body
def parse(md):
    lines = md.split('\n')
    flow, i = [], 0
    para = []

    def flush():
        if para:
            text = ' '.join(para)
            style = S['body_left'] if re.match(r'^[A-E]\. ', text) else S['body']
            flow.append(Paragraph(inline(text), style))
            para.clear()

    while i < len(lines):
        ln = lines[i]
        st = ln.strip()
        if st.startswith('```'):
            flush()
            j = i + 1
            buf = []
            while j < len(lines) and not lines[j].strip().startswith('```'):
                buf.append(lines[j]); j += 1
            flow.append(KeepTogether([Preformatted('\n'.join(buf), S['code']), Spacer(1, 10)]) if len(buf) < 48 else Preformatted('\n'.join(buf), S['code']))
            i = j + 1
            continue
        if st == '<!-- SCREENSHOTS -->':
            flush(); flow.extend(screenshots()); i += 1; continue
        if st == '---' or not st:
            flush(); i += 1; continue
        m = re.match(r'^## (CHAPTER \d+: .+|APPENDIX)$', st)
        if m:
            flush()
            flow.append(PageBreak())
            flow.append(heading(m.group(1), 'h1', 0))
            i += 1; continue
        m = re.match(r'^### (.+)$', st)
        if m:
            flush(); flow.append(heading(m.group(1), 'h2', 1)); i += 1; continue
        if st.startswith('|'):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-{3,}:?', c) for c in cells):
                    rows.append(cells)
                i += 1
            flow.extend(table(rows))
            continue
        m = re.match(r'^(\s*)[-*] (.+)$', ln)
        if m:
            flush()
            style = 'bullet2' if len(m.group(1)) >= 2 else 'bullet'
            flow.append(Paragraph(inline(m.group(2)), S[style], bulletText='•' if style == 'bullet' else '–'))
            i += 1; continue
        m = re.match(r'^(\d+)\. (.+)$', st)
        if m:
            flush()
            # Lines carrying URLs or file paths read better ragged-right than stretched to the margin.
            style = S['bullet_left'] if ('http' in m.group(2) or '`' in m.group(2)) else S['bullet']
            flow.append(Paragraph(inline(m.group(2)), style, bulletText=m.group(1) + '.'))
            i += 1; continue
        # A line that is only bold text (e.g. "**Core HR**") is a level-3 heading.
        m = re.fullmatch(r'\*\*([^*]+)\*\*', st)
        if m:
            flush(); flow.append(Paragraph(inline(m.group(1)), S['h3'])); i += 1; continue
        # An italic-only line ("*Frontend phase:*") is a level-3 heading too.
        m = re.fullmatch(r'\*([^*]+)\*', st)
        if m:
            flush(); flow.append(Paragraph(inline(m.group(1)), S['h3'])); i += 1; continue
        para.append(st)
        i += 1
    flush()
    return flow


def title_page():
    f = [Spacer(1, 0.6 * inch),
         Paragraph('SOFTWARE PROJECT REPORT', S['tptitle']), Spacer(1, 18),
         Paragraph('B.Tech 2nd Year – Computer Science and Engineering (Data Science)', S['tp']),
         Paragraph('Academic Session: 2026–2027', S['tp']), Spacer(1, 1.1 * inch),
         Paragraph('Project Title', S['tpb']), Spacer(1, 8),
         Paragraph('Riona — An Integrated Office Management System with Event-Sourced Payroll and Unified Time Accounting', S['tptitle']),
         Spacer(1, 1.2 * inch),
         Paragraph('Submitted by', S['tpb']), Spacer(1, 6),
         Paragraph('Shrijib Maiti', S['tp']),
         Paragraph('Roll No. 56', S['tp']),
         Spacer(1, 1.5 * inch),
         Paragraph('Department of Computer Science and Engineering (Data Science)', S['tpb']),
         Paragraph('University of Engineering &amp; Management, Kolkata', S['tpb']),
         NextPageTemplate('body'), PageBreak()]
    return f


def build():
    md = open(SRC, encoding='utf-8').read()
    body_md = md[md.index('## CHAPTER 1:'):]
    toc = TableOfContents()
    toc.levelStyles = [S['toc0'], S['toc1']]
    toc.dotsMinLevel = 0
    story = title_page()
    story += [Paragraph('TABLE OF CONTENTS', S['h1']), toc]
    story += parse(body_md)
    doc = Doc(OUT)
    doc.multiBuild(story)
    print('written', OUT, round(os.path.getsize(OUT) / 1e6, 1), 'MB')


if __name__ == '__main__':
    build()
