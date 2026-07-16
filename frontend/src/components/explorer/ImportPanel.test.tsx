import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ImportPanel, { parseImportText } from "./ImportPanel";

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

  it("shows parse errors without calling onImport", async () => {
    const onImport = vi.fn();
    render(() => <ImportPanel onImport={onImport} />);
    fireEvent.input(screen.getByLabelText(/Objects/), { target: { value: "garbage" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/JSON array or NDJSON/);
    expect(onImport).not.toHaveBeenCalled();
  });
});
