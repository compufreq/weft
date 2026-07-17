import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ImportPanel, { parseCsvObjects, parseCsvRows, parseImportText } from "./ImportPanel";
import type { Property } from "~/lib/api";

const schema: Property[] = [
  { name: "title", dataType: ["text"] },
  { name: "wordCount", dataType: ["int"] },
  { name: "score", dataType: ["number"] },
  { name: "published", dataType: ["boolean"] },
];

describe("parseImportText", () => {
  it("accepts a JSON array of bare property maps", () => {
    expect(parseImportText('[{ "a": 1 }, { "a": 2 }]')).toEqual([
      { properties: { a: 1 } },
      { properties: { a: 2 } },
    ]);
  });

  it("accepts NDJSON, including Weft's export shape with id/properties", () => {
    const ndjson = [
      '{"id":"u-1","class":"Article","properties":{"title":"x"}}',
      '{"title":"bare"}',
    ].join("\n");
    expect(parseImportText(ndjson)).toEqual([
      { properties: { title: "x" }, id: "u-1", vector: undefined },
      { properties: { title: "bare" } },
    ]);
  });

  it("accepts a single object and a wrapped {objects: []} document", () => {
    expect(parseImportText('{ "a": 1 }')).toEqual([{ properties: { a: 1 } }]);
    expect(parseImportText('{ "objects": [{ "a": 1 }] }')).toEqual([
      { properties: { a: 1 } },
    ]);
  });

  it("throws helpful errors on garbage", () => {
    expect(() => parseImportText("")).toThrow(/Nothing/);
    expect(() => parseImportText("hello")).toThrow(/JSON array or NDJSON/);
    expect(() => parseImportText('{"a":1}\nnope')).toThrow(/Line 2/);
    expect(() => parseImportText("[1, 2]")).toThrow(/Entry 1/);
  });
});

describe("parseCsvRows", () => {
  it("handles quoted fields, escaped quotes, commas, and CRLF", () => {
    const csv = 'a,b,c\r\n"one, two","say ""hi""",plain\nlast,"multi\nline",x';
    expect(parseCsvRows(csv)).toEqual([
      ["a", "b", "c"],
      ["one, two", 'say "hi"', "plain"],
      ["last", "multi\nline", "x"],
    ]);
  });

  it("tolerates a trailing newline and rejects unclosed quotes", () => {
    expect(parseCsvRows("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(() => parseCsvRows('a\n"unclosed')).toThrow(/Unclosed quote/);
  });
});

describe("parseCsvObjects", () => {
  it("coerces cell types from the schema and omits empty cells", () => {
    const csv = [
      "title,wordCount,score,published,unknownProp",
      "Hello,42,4.5,true,keep-as-text",
      '"quoted, title",7,,false,',
    ].join("\n");
    expect(parseCsvObjects(csv, schema)).toEqual([
      {
        properties: {
          title: "Hello",
          wordCount: 42,
          score: 4.5,
          published: true,
          unknownProp: "keep-as-text",
        },
      },
      { properties: { title: "quoted, title", wordCount: 7, published: false } },
    ]);
  });

  it("maps id and vector special columns", () => {
    const csv = 'id,title,vector\nu-1,Hi,"[0.1, 0.2]"';
    expect(parseCsvObjects(csv, schema)).toEqual([
      { id: "u-1", properties: { title: "Hi" }, vector: [0.1, 0.2] },
    ]);
  });

  it("reports the failing row and column on bad values", () => {
    expect(() => parseCsvObjects("wordCount\nabc", schema)).toThrow(
      /Row 2: "abc" is not an integer for "wordCount"/,
    );
    expect(() => parseCsvObjects("published\nyes", schema)).toThrow(/true\/false/);
    expect(() => parseCsvObjects("title,vector\nx,nope", schema)).toThrow(
      /JSON number array/,
    );
    expect(() => parseCsvObjects("a,b\n1", schema)).toThrow(
      /Row 2 has 1 fields, header has 2/,
    );
    expect(() => parseCsvObjects("only-header", schema)).toThrow(/at least one data row/);
  });
});

describe("ImportPanel", () => {
  it("imports parsed objects and renders the outcome report", async () => {
    const onImport = vi.fn().mockResolvedValue({
      inserted: 2,
      failed: 1,
      errors: [{ index: 1, message: "wordCount must be int" }],
    });
    render(() => <ImportPanel onImport={onImport} />);
    fireEvent.input(screen.getByLabelText(/Objects/), {
      target: { value: '[{"a":1},{"a":"x"},{"a":3}]' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("2 inserted");
      expect(screen.getByRole("status")).toHaveTextContent("1 failed");
      expect(screen.getByRole("status")).toHaveTextContent("wordCount must be int");
    });
    expect(onImport).toHaveBeenCalledWith([
      { properties: { a: 1 } },
      { properties: { a: "x" } },
      { properties: { a: 3 } },
    ]);
  });

  it("imports CSV text using the schema for coercion", async () => {
    const onImport = vi.fn().mockResolvedValue({ inserted: 1, failed: 0, errors: [] });
    render(() => <ImportPanel onImport={onImport} properties={schema} />);
    fireEvent.input(screen.getByLabelText(/Objects/), {
      target: { value: "title,wordCount\nHello,42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("1 inserted");
    });
    expect(onImport).toHaveBeenCalledWith([
      { properties: { title: "Hello", wordCount: 42 } },
    ]);
  });

  it("shows parse errors without calling onImport", async () => {
    const onImport = vi.fn();
    render(() => <ImportPanel onImport={onImport} properties={schema} />);
    // Non-JSON text goes down the CSV path; a lone line has no data rows.
    fireEvent.input(screen.getByLabelText(/Objects/), { target: { value: "garbage" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/header row/);
    expect(onImport).not.toHaveBeenCalled();
  });
});
