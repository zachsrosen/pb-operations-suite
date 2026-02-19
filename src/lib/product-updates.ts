export interface UpdateChange {
  type: "feature" | "improvement" | "fix" | "internal";
  text: string;
}

export interface UpdateEntry {
  version: string;
  date: string;
  title: string;
  description: string;
  changes: UpdateChange[];
}
