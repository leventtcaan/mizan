"""
WHAT: Extracts raw text and table data from PDF/CSV bank statements using pdfplumber.
WHY: Separates file parsing from LLM categorization — raw extraction is deterministic
     and fast; LLM enrichment is expensive and async. Keeping them separate lets us
     re-run enrichment without re-parsing the file.
BREAKS IF REMOVED: Upload pipeline has no way to extract transaction data from files;
                   LLM services receive nothing to categorize.
"""

import csv
import io
import logging
from dataclasses import dataclass, field

import pdfplumber

logger = logging.getLogger(__name__)


@dataclass
class RawTransaction:
    """
    WHAT: Intermediate representation of one transaction extracted from a statement.
    WHY: Decouples the parser output from the SQLAlchemy model — parser stays pure
         (no DB imports); the service layer maps RawTransaction → Transaction model.
    """

    date: str
    description: str
    amount: str
    transaction_type: str
    raw_row: list[str] = field(default_factory=list)


@dataclass
class ParseResult:
    """
    WHAT: Full output of a parse attempt — transactions plus metadata for observability.
    WHY: Returning structured metadata (page count, row count) lets the upload endpoint
         log useful diagnostics without coupling the parser to HTTP concerns.
    """

    transactions: list[RawTransaction]
    page_count: int
    raw_row_count: int
    source_type: str


def parse_statement(contents: bytes, content_type: str, filename: str) -> ParseResult:
    """
    WHAT: Routes file bytes to the correct parser based on content type.
    WHY: Single entry point — callers never inspect content_type themselves.
    BREAKS IF REMOVED: Upload endpoint has no way to dispatch to PDF vs CSV logic.
    """
    logger.info("Parsing statement — filename=%s content_type=%s size=%d", filename, content_type, len(contents))

    if content_type == "application/pdf":
        return _parse_pdf(contents)

    # WHY: Both text/csv and application/vnd.ms-excel are routed here —
    # vnd.ms-excel is the MIME type browsers assign to .csv files on Windows.
    return _parse_csv(contents)


def _parse_pdf(contents: bytes) -> ParseResult:
    """
    WHAT: Extracts table rows from all pages of a PDF bank statement.
    WHY: pdfplumber's table extraction understands cell boundaries drawn by ruling lines,
         which is how Turkish bank statements (Garanti, İş, Yapı Kredi) lay out transactions.
    BREAKS IF REMOVED: PDF statements produce no transactions.
    """
    transactions: list[RawTransaction] = []
    page_count = 0
    raw_row_count = 0

    # WHY: io.BytesIO wraps bytes into a file-like object — pdfplumber expects a file handle,
    # not raw bytes. Avoids writing a temp file to disk.
    with pdfplumber.open(io.BytesIO(contents)) as pdf:
        page_count = len(pdf.pages)
        logger.info("PDF opened — %d pages", page_count)

        for page_num, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()

            if not tables:
                logger.debug("Page %d — no tables found, attempting text extraction", page_num)
                continue

            for table in tables:
                for row in table:
                    if not row:
                        continue

                    # WHY: Strip None cells (pdfplumber fills sparse tables with None).
                    # Convert to str so downstream code never sees None.
                    cleaned = [str(cell).strip() if cell is not None else "" for cell in row]
                    raw_row_count += 1

                    parsed = _classify_pdf_row(cleaned)
                    if parsed:
                        transactions.append(parsed)

    logger.info("PDF parse complete — %d raw rows, %d transactions extracted", raw_row_count, len(transactions))

    return ParseResult(
        transactions=transactions,
        page_count=page_count,
        raw_row_count=raw_row_count,
        source_type="pdf",
    )


def _parse_csv(contents: bytes) -> ParseResult:
    """
    WHAT: Extracts transaction rows from a CSV bank statement.
    WHY: CSV statements from Turkish banks use semicolon or comma delimiters and
         UTF-8 or ISO-8859-9 encoding. We attempt UTF-8 first, fall back to latin-1.
    BREAKS IF REMOVED: CSV statements produce no transactions.
    """
    transactions: list[RawTransaction] = []
    raw_row_count = 0

    # WHY: Try UTF-8 first (modern exports); fall back to latin-1 which covers
    # ISO-8859-9 (Turkish character set used by older banking systems).
    try:
        text = contents.decode("utf-8")
    except UnicodeDecodeError:
        text = contents.decode("latin-1")
        logger.info("CSV decoded with latin-1 fallback")

    # WHY: Sniff the delimiter — Turkish bank CSVs use both ',' and ';'.
    # If sniffing fails, default to semicolon (most common in Turkish exports).
    try:
        dialect = csv.Sniffer().sniff(text[:2048])
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"
        logger.info("CSV delimiter sniff failed — defaulting to semicolon")

    reader = csv.reader(io.StringIO(text), dialect=dialect)

    for row in reader:
        if not row:
            continue

        raw_row_count += 1
        parsed = _classify_csv_row(row)
        if parsed:
            transactions.append(parsed)

    logger.info("CSV parse complete — %d raw rows, %d transactions extracted", raw_row_count, len(transactions))

    return ParseResult(
        transactions=transactions,
        page_count=1,
        raw_row_count=raw_row_count,
        source_type="csv",
    )


def _classify_pdf_row(row: list[str]) -> RawTransaction | None:
    """
    WHAT: Attempts to interpret one PDF table row as a transaction.
    WHY: PDF tables contain header rows, subtotal rows, and blank spacers that are
         not transactions. This function filters them out heuristically.
    BREAKS IF REMOVED: Header and subtotal rows pollute the transaction list.
    """
    # WHY: Rows with fewer than 3 cells can't carry date + description + amount.
    if len(row) < 3:
        return None

    # WHY: Skip rows where the first cell looks like a header keyword.
    # Turkish bank PDFs use these exact strings as column headers.
    first = row[0].lower()
    header_signals = {"tarih", "date", "açıklama", "tutar", "bakiye", "no", "#", ""}
    if first in header_signals:
        return None

    # WHY: Amount cell must contain a digit — subtotal label rows don't.
    amount_candidate = row[-1].replace(".", "").replace(",", ".").strip()
    if not any(ch.isdigit() for ch in amount_candidate):
        return None

    # WHY: transaction_type inferred from sign or keyword in the row.
    # Turkish statements often have a separate "Borç/Alacak" (debit/credit) column.
    raw_text = " ".join(row).lower()
    if "alacak" in raw_text or "+" in row[-1]:
        transaction_type = "credit"
    else:
        transaction_type = "debit"

    return RawTransaction(
        date=row[0],
        description=row[1] if len(row) > 1 else "",
        amount=amount_candidate,
        transaction_type=transaction_type,
        raw_row=row,
    )


def _classify_csv_row(row: list[str]) -> RawTransaction | None:
    """
    WHAT: Attempts to interpret one CSV row as a transaction.
    WHY: Same filtering logic as PDF — CSV exports also contain header and summary rows.
    BREAKS IF REMOVED: Header rows pollute the transaction list.
    """
    if len(row) < 3:
        return None

    first = row[0].strip().lower()
    header_signals = {"tarih", "date", "açıklama", "tutar", "bakiye", "no", "#", ""}
    if first in header_signals:
        return None

    amount_candidate = row[-1].replace(".", "").replace(",", ".").strip()
    if not any(ch.isdigit() for ch in amount_candidate):
        return None

    raw_text = " ".join(row).lower()
    if "alacak" in raw_text or (len(row) > 2 and "+" in row[-1]):
        transaction_type = "credit"
    else:
        transaction_type = "debit"

    return RawTransaction(
        date=row[0].strip(),
        description=row[1].strip() if len(row) > 1 else "",
        amount=amount_candidate,
        transaction_type=transaction_type,
        raw_row=row,
    )
