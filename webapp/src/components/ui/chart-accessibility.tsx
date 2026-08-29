import type { ReactNode } from "react";

export type ChartTableColumn<Row> = {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
};

export function ChartAccessibility<Row>({
  summary,
  caption,
  rows,
  columns,
  rowKey,
}: {
  summary: ReactNode;
  caption: ReactNode;
  rows: Row[];
  columns: Array<ChartTableColumn<Row>>;
  rowKey: (row: Row) => string;
}) {
  return (
    <div className="sr-only">
      <p>{summary}</p>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column, index) => {
                const Cell = index === 0 ? "th" : "td";
                return (
                  <Cell key={column.key} {...(index === 0 ? { scope: "row" } : {})}>
                    {column.render(row)}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
