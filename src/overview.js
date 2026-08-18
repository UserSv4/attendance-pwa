import { STATUS_KEYS, STATUS_META } from "./constants.js";
import {
  formatGeneratedAt,
  formatOverviewDateHeader,
  formatOverviewRange
} from "./dates.js";
import { getEntry, getOverviewPeople, statusDistribution } from "./model.js";

const IMAGE_WIDTH = 1400;
const SIDE_MARGIN = 64;
const TABLE_TOP = 192;
const TABLE_HEADER_HEIGHT = 102;
const ROW_HEIGHT = 64;
const TOTALS_HEIGHT = 100;
const FOOTER_HEIGHT = 142;
const NAME_COLUMN_WIDTH = 438;
export const OVERVIEW_PAGE_SIZE = 50;
export const MAX_OVERVIEW_CANVAS_HEIGHT = 4096;
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function roundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function fillRoundedRect(context, x, y, width, height, radius, fillStyle) {
  roundedRectPath(context, x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
}

function truncateText(context, value, maxWidth) {
  const text = String(value);
  if (context.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, middle)}…`).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low)}…`;
}

function drawCenteredText(context, text, x, y, options = {}) {
  context.save();
  context.fillStyle = options.color ?? "#28231F";
  context.font = `${options.weight ?? 700} ${options.size ?? 24}px ${FONT_FAMILY}`;
  context.textAlign = "center";
  context.textBaseline = options.baseline ?? "middle";
  context.fillText(text, x, y);
  context.restore();
}

function drawStatusCell(context, status, centerX, centerY) {
  if (!status || !STATUS_META[status]) {
    drawCenteredText(context, "—", centerX, centerY, { size: 28, weight: 650, color: "#B5AAA0" });
    return;
  }

  const meta = STATUS_META[status];
  fillRoundedRect(context, centerX - 40, centerY - 22, 80, 44, 15, meta.softColor);
  fillRoundedRect(context, centerX - 16, centerY - 16, 32, 32, 11, meta.color);
  drawCenteredText(context, meta.mark, centerX, centerY + 1, { size: 17, weight: 900, color: "#FFFFFF" });
}

function drawHeader(context, dateKeys, pageNumber, pageCount) {
  context.fillStyle = "#28231F";
  context.font = `850 52px ${FONT_FAMILY}`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText("Посещаемость", SIDE_MARGIN, 76);

  context.fillStyle = "#6F655D";
  context.font = `650 24px ${FONT_FAMILY}`;
  context.fillText(formatOverviewRange(dateKeys), SIDE_MARGIN, 116);

  context.fillStyle = "#9A8E84";
  context.font = `550 18px ${FONT_FAMILY}`;
  context.fillText(`Сформировано ${formatGeneratedAt()}`, SIDE_MARGIN, 151);

  if (pageCount > 1) {
    const label = `${pageNumber} / ${pageCount}`;
    fillRoundedRect(context, IMAGE_WIDTH - SIDE_MARGIN - 118, 51, 118, 48, 16, "#F6E9DB");
    drawCenteredText(context, label, IMAGE_WIDTH - SIDE_MARGIN - 59, 76, {
      size: 19,
      weight: 800,
      color: "#704329"
    });
  }
}

function drawTableHeader(context, dateKeys, tableWidth, dateColumnWidth) {
  fillRoundedRect(
    context,
    SIDE_MARGIN,
    TABLE_TOP,
    tableWidth,
    TABLE_HEADER_HEIGHT,
    22,
    "#5D3822"
  );

  context.fillStyle = "#F7E4D5";
  context.font = `800 17px ${FONT_FAMILY}`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText("ЛЮДИ", SIDE_MARGIN + 24, TABLE_TOP + TABLE_HEADER_HEIGHT / 2);

  dateKeys.forEach((dateKey, index) => {
    const parts = formatOverviewDateHeader(dateKey);
    const centerX = SIDE_MARGIN + NAME_COLUMN_WIDTH + dateColumnWidth * index + dateColumnWidth / 2;
    drawCenteredText(context, parts.weekday, centerX, TABLE_TOP + 35, {
      size: 17,
      weight: 800,
      color: "#F2D8C5"
    });
    drawCenteredText(context, parts.date, centerX, TABLE_TOP + 67, {
      size: 23,
      weight: 820,
      color: "#FFFFFF"
    });
  });
}

function drawPersonRows(context, state, dateKeys, people, tableWidth, dateColumnWidth) {
  const rowsTop = TABLE_TOP + TABLE_HEADER_HEIGHT;
  context.textBaseline = "middle";

  people.forEach((person, rowIndex) => {
    const y = rowsTop + rowIndex * ROW_HEIGHT;
    context.fillStyle = rowIndex % 2 ? "#FFFBF7" : "#FFFFFF";
    context.fillRect(SIDE_MARGIN, y, tableWidth, ROW_HEIGHT);

    context.strokeStyle = "#EEE4DA";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(SIDE_MARGIN, y + ROW_HEIGHT);
    context.lineTo(SIDE_MARGIN + tableWidth, y + ROW_HEIGHT);
    context.stroke();

    context.fillStyle = "#302923";
    context.font = `720 22px ${FONT_FAMILY}`;
    context.textAlign = "left";
    const visibleName = truncateText(context, person.name, NAME_COLUMN_WIDTH - 48);
    context.fillText(visibleName, SIDE_MARGIN + 24, y + ROW_HEIGHT / 2 + 1);

    dateKeys.forEach((dateKey, dateIndex) => {
      const centerX = SIDE_MARGIN + NAME_COLUMN_WIDTH + dateColumnWidth * dateIndex + dateColumnWidth / 2;
      const status = getEntry(state, dateKey, person.id)?.status;
      drawStatusCell(context, status, centerX, y + ROW_HEIGHT / 2);
    });
  });

  context.strokeStyle = "#E8DCD1";
  context.lineWidth = 2;
  for (let index = 0; index <= dateKeys.length; index += 1) {
    const x = SIDE_MARGIN + NAME_COLUMN_WIDTH + dateColumnWidth * index;
    context.beginPath();
    context.moveTo(x, TABLE_TOP);
    context.lineTo(x, rowsTop + people.length * ROW_HEIGHT + TOTALS_HEIGHT);
    context.stroke();
  }
}

function drawTotals(context, state, dateKeys, allPeople, peopleCount, tableWidth, dateColumnWidth) {
  const y = TABLE_TOP + TABLE_HEADER_HEIGHT + peopleCount * ROW_HEIGHT;
  context.fillStyle = "#F7EFE7";
  context.fillRect(SIDE_MARGIN, y, tableWidth, TOTALS_HEIGHT);

  context.fillStyle = "#6C5F55";
  context.font = `800 17px ${FONT_FAMILY}`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText("ИТОГО", SIDE_MARGIN + 24, y + TOTALS_HEIGHT / 2);

  dateKeys.forEach((dateKey, index) => {
    const counts = statusDistribution(state, dateKey, allPeople);
    const centerX = SIDE_MARGIN + NAME_COLUMN_WIDTH + dateColumnWidth * index + dateColumnWidth / 2;
    drawCenteredText(context, `${counts.present}/${allPeople.length}`, centerX, y + 35, {
      size: 23,
      weight: 850,
      color: STATUS_META.present.darkColor
    });
    drawCenteredText(context, `Б ${counts.sick} · З ${counts.drunk} · Н ${counts.absent}`, centerX, y + 67, {
      size: 12,
      weight: 720,
      color: "#75695F"
    });
  });
}

function drawFooter(context, footerTop, pageNumber, pageCount) {
  const legendY = footerTop + 45;
  let x = SIDE_MARGIN;

  for (const status of STATUS_KEYS) {
    const meta = STATUS_META[status];
    fillRoundedRect(context, x, legendY - 16, 32, 32, 10, meta.color);
    drawCenteredText(context, meta.mark, x + 16, legendY + 1, { size: 16, weight: 900, color: "#FFFFFF" });
    context.fillStyle = "#514840";
    context.font = `650 18px ${FONT_FAMILY}`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    const label = status === "present" ? "Присутствует" : meta.compactLabel;
    context.fillText(label, x + 43, legendY);
    x += status === "present" ? 220 : 190;
  }

  if (pageCount > 1) {
    context.fillStyle = "#A09489";
    context.font = `550 16px ${FONT_FAMILY}`;
    context.textAlign = "right";
    context.fillText(`Страница ${pageNumber} из ${pageCount}`, IMAGE_WIDTH - SIDE_MARGIN, legendY);
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create overview image"));
    }, "image/png");
  });
}

export function getOverviewCanvasHeight(rowCount) {
  return TABLE_TOP + TABLE_HEADER_HEIGHT + rowCount * ROW_HEIGHT + TOTALS_HEIGHT + FOOTER_HEIGHT;
}

export function paginatePeople(people, pageSize = OVERVIEW_PAGE_SIZE) {
  if (!people.length) return [];
  const pages = [];
  for (let index = 0; index < people.length; index += pageSize) {
    pages.push(people.slice(index, index + pageSize));
  }
  return pages;
}

export async function generateOverviewFiles(state, dateKeys) {
  const allPeople = getOverviewPeople(state, dateKeys);
  const pages = paginatePeople(allPeople);
  const files = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const people = pages[pageIndex];
    const pageCount = pages.length;
    const tableWidth = IMAGE_WIDTH - SIDE_MARGIN * 2;
    const dateColumnWidth = (tableWidth - NAME_COLUMN_WIDTH) / dateKeys.length;
    const canvasHeight = getOverviewCanvasHeight(people.length);
    if (canvasHeight > MAX_OVERVIEW_CANVAS_HEIGHT) {
      throw new RangeError(`Overview page exceeds the safe canvas height: ${canvasHeight}px`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_WIDTH;
    canvas.height = canvasHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas is unavailable");

    const background = context.createLinearGradient(0, 0, IMAGE_WIDTH, canvasHeight);
    background.addColorStop(0, "#FFFBF5");
    background.addColorStop(1, "#F8EEE4");
    context.fillStyle = background;
    context.fillRect(0, 0, IMAGE_WIDTH, canvasHeight);

    drawHeader(context, dateKeys, pageIndex + 1, pageCount);
    drawTableHeader(context, dateKeys, tableWidth, dateColumnWidth);
    drawPersonRows(context, state, dateKeys, people, tableWidth, dateColumnWidth);
    drawTotals(context, state, dateKeys, allPeople, people.length, tableWidth, dateColumnWidth);
    drawFooter(
      context,
      TABLE_TOP + TABLE_HEADER_HEIGHT + people.length * ROW_HEIGHT + TOTALS_HEIGHT,
      pageIndex + 1,
      pageCount
    );

    const blob = await canvasToBlob(canvas);
    const suffix = pageCount > 1 ? `-${pageIndex + 1}` : "";
    const fileName = `poseshchaemost-${dateKeys.at(-1)}${suffix}.png`;
    files.push(new File([blob], fileName, { type: "image/png", lastModified: Date.now() }));
  }

  return files;
}
