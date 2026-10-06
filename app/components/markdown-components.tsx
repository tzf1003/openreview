"use client";

import { colors } from "@xsec/design-tokens";
import {
  ControlButton,
  Dialog,
  PageHeader,
  Select,
  useThemeSettings,
} from "@xsec/ui-react";
import type {
  ComponentProps,
  ComponentPropsWithoutRef,
  ReactElement,
} from "react";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ExtraProps } from "streamdown";
import {
  CodeBlock,
  StreamdownContext,
  extractTableDataFromElement,
  tableDataToCSV,
  tableDataToMarkdown,
  tableDataToTSV,
} from "streamdown";

import { ContentActions } from "./content-actions";

type MarkdownElement = NonNullable<ExtraProps["node"]>;

const containsImage = (node: MarkdownElement): boolean =>
  node.tagName === "img" ||
  node.children.some(
    (child) => child.type === "element" && containsImage(child)
  );

const Paragraph = ({
  node,
  children,
  ...props
}: ComponentProps<"p"> & ExtraProps) =>
  node && containsImage(node) ? (
    <div {...props}>{children}</div>
  ) : (
    <p {...props}>{children}</p>
  );

const Title = ({ children }: ComponentProps<"h1"> & ExtraProps) => (
  <PageHeader title={children} />
);

const headingText = (node: MarkdownElement): string =>
  node.children
    .map((child) => {
      if (child.type === "text") {
        return child.value;
      }
      if (child.type === "element") {
        return headingText(child);
      }
      return "";
    })
    .join("");

const Heading = ({
  node,
  children,
  ...props
}: ComponentProps<"h2"> & ExtraProps) => {
  if (!node) {
    throw new TypeError("Documentation heading is missing its Markdown node");
  }
  const id = headingText(node)
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "");
  if (!id) {
    throw new TypeError("Documentation heading must have a readable title");
  }
  return (
    <h2 {...props} id={id}>
      {children}
    </h2>
  );
};

type BlockCodeProps = ComponentProps<"code"> & { "data-block"?: string };

const diagramTheme = (mode: keyof typeof colors) => {
  const palette = colors[mode];
  return {
    config: {
      theme: "base" as const,
      themeVariables: {
        actorBkg: palette.subtle,
        actorBorder: palette.border,
        actorTextColor: palette.text,
        background: palette.surface,
        darkMode: mode === "dark",
        labelBoxBkgColor: palette.surface,
        labelBoxBorderColor: palette.border,
        labelTextColor: palette.text,
        lineColor: palette.muted,
        noteBkgColor: palette.subtle,
        noteBorderColor: palette.border,
        noteTextColor: palette.text,
        primaryBorderColor: palette.border,
        primaryColor: palette.subtle,
        primaryTextColor: palette.text,
        signalColor: palette.text,
        signalTextColor: palette.text,
        textColor: palette.text,
      },
    },
  };
};

const diagramThemes = {
  dark: diagramTheme("dark"),
  light: diagramTheme("light"),
};

const Diagram = ({
  element,
  source,
}: {
  element: ReactElement<BlockCodeProps>;
  source: string;
}) => {
  const baseContext = useContext(StreamdownContext);
  const { colorMode } = useThemeSettings();
  const context = useMemo(
    () => ({ ...baseContext, mermaid: diagramThemes[colorMode] }),
    [baseContext, colorMode]
  );
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const show = useCallback(() => setExpanded(true), []);
  const getText = useCallback(() => source, [source]);
  return (
    <StreamdownContext.Provider value={context}>
      <div className="reading-diagram">
        <ContentActions
          filename="diagram.mmd"
          getText={getText}
          label="diagram source"
        >
          <ControlButton onClick={show} ref={trigger} variant="ghost">
            View full diagram
          </ControlButton>
        </ContentActions>
        {cloneElement(element, { "data-block": "true" })}
        <Dialog
          className="reading-fullscreen"
          finalFocus={trigger}
          onOpenChange={setExpanded}
          open={expanded}
          title="Workflow diagram"
        >
          {cloneElement(element, { "data-block": "true" })}
        </Dialog>
      </div>
    </StreamdownContext.Provider>
  );
};

const Pre = ({ children }: ComponentProps<"pre"> & ExtraProps) => {
  if (!isValidElement<BlockCodeProps>(children)) {
    throw new TypeError("Documentation code block is missing its code element");
  }
  const source = children.props.children;
  if (typeof source !== "string") {
    throw new TypeError("Documentation code block must contain text");
  }
  const language = children.props.className?.match(/language-(\S+)/)?.[1] ?? "";
  const getText = useCallback(() => source, [source]);
  if (language === "mermaid") {
    return <Diagram element={children} source={source} />;
  }
  return (
    <CodeBlock
      aria-label="Code example"
      className="reading-code"
      code={source}
      language={language}
      role="region"
      tabIndex={0}
    >
      <ContentActions
        filename={`${language || "code"}.txt`}
        getText={getText}
        label="code"
      />
    </CodeBlock>
  );
};

const tableFormats = [
  { label: "Markdown", value: "markdown" },
  { label: "CSV", value: "csv" },
  { label: "TSV", value: "tsv" },
];

const Table = ({
  node: _node,
  children,
  ...props
}: ComponentPropsWithoutRef<"table"> & ExtraProps) => {
  const ref = useRef<HTMLTableElement>(null);
  const [format, setFormat] = useState("markdown");
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const show = useCallback(() => setExpanded(true), []);

  const changeFormat = useCallback((value: string | null) => {
    if (value !== "markdown" && value !== "csv" && value !== "tsv") {
      throw new TypeError("Unsupported documentation table format");
    }
    setFormat(value);
  }, []);

  const getText = useCallback(() => {
    if (!ref.current) {
      throw new Error("Documentation table is unavailable");
    }
    const data = extractTableDataFromElement(ref.current);
    if (format === "csv") {
      return tableDataToCSV(data);
    }
    if (format === "tsv") {
      return tableDataToTSV(data);
    }
    return tableDataToMarkdown(data);
  }, [format]);

  return (
    <div className="reading-table" data-streamdown="table-wrapper">
      <ContentActions
        filename={format === "markdown" ? "table.md" : `table.${format}`}
        getText={getText}
        label="table"
      >
        <Select
          aria-label="Table format"
          className="reading-format"
          onValueChange={changeFormat}
          options={tableFormats}
          value={format}
        />
        <ControlButton onClick={show} ref={trigger} variant="ghost">
          View full table
        </ControlButton>
      </ContentActions>
      <div
        aria-label="Documentation table"
        className="reading-table-scroll"
        role="region"
        tabIndex={0}
      >
        <table {...props} ref={ref}>
          {children}
        </table>
      </div>
      <Dialog
        className="reading-fullscreen"
        finalFocus={trigger}
        onOpenChange={setExpanded}
        open={expanded}
        title="Documentation table"
      >
        <div className="reading-table">
          <ContentActions
            filename={format === "markdown" ? "table.md" : `table.${format}`}
            getText={getText}
            label="table"
          >
            <Select
              aria-label="Table format"
              className="reading-format"
              onValueChange={changeFormat}
              options={tableFormats}
              value={format}
            />
          </ContentActions>
          <div
            aria-label="Expanded documentation table"
            className="reading-table-scroll"
            role="region"
            tabIndex={0}
          >
            <table {...props}>{children}</table>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export const markdownComponents = {
  h1: Title,
  h2: Heading,
  p: Paragraph,
  pre: Pre,
  table: Table,
};
