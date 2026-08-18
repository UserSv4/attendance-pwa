export const SCHEMA_VERSION = 1;
export const HISTORY_WINDOW_DAYS = 7;

export const STATUS_KEYS = Object.freeze(["present", "sick", "drunk"]);

export const STATUS_META = Object.freeze({
  present: Object.freeze({
    label: "Присутствует",
    compactLabel: "Здесь",
    summaryLabel: "Здесь",
    mark: "П",
    color: "#F28C28",
    softColor: "#FFF0DC",
    darkColor: "#9D4F0F"
  }),
  sick: Object.freeze({
    label: "Отсутствует — заболел",
    compactLabel: "Заболел",
    summaryLabel: "Болеют",
    mark: "Б",
    color: "#2E9B69",
    softColor: "#E7F6EE",
    darkColor: "#176641"
  }),
  drunk: Object.freeze({
    label: "Отсутствует — забухал",
    compactLabel: "Забухал",
    summaryLabel: "Забухали",
    mark: "З",
    color: "#D94D48",
    softColor: "#FDEBEA",
    darkColor: "#96312E"
  })
});

export const isValidStatus = (value) => STATUS_KEYS.includes(value);
