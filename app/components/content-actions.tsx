"use client";

import { ControlButton } from "@xsec/ui-react";
import { Copy, Download } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";

interface ContentActionsProps {
  getText: () => string;
  filename: string;
  label: string;
  children?: ReactNode;
}

export const ContentActions = ({
  getText,
  filename,
  label,
  children,
}: ContentActionsProps) => {
  const [feedback, setFeedback] = useState<{
    failed: boolean;
    message: string;
  } | null>(null);
  const [copying, setCopying] = useState(false);

  const copy = useCallback(async () => {
    setCopying(true);
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(getText());
      setFeedback({ failed: false, message: "Copied." });
    } catch {
      setFeedback({
        failed: true,
        message: "Copy failed. Check clipboard permission and try again.",
      });
    } finally {
      setCopying(false);
    }
  }, [getText]);

  const download = useCallback(() => {
    setFeedback(null);
    try {
      const url = URL.createObjectURL(
        new Blob([getText()], { type: "text/plain;charset=utf-8" })
      );
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setFeedback({ failed: false, message: "Download started." });
    } catch {
      setFeedback({ failed: true, message: "Download failed. Try again." });
    }
  }, [filename, getText]);

  return (
    <div className="reading-actions">
      <div aria-label={`${label} actions`} className="reading-action-buttons">
        {children}
        <ControlButton
          aria-label={`Copy ${label}`}
          loading={copying}
          onClick={copy}
          variant="ghost"
        >
          <Copy aria-hidden="true" />
          Copy
        </ControlButton>
        <ControlButton
          aria-label={`Download ${label}`}
          onClick={download}
          variant="ghost"
        >
          <Download aria-hidden="true" />
          Download
        </ControlButton>
      </div>
      {feedback ? (
        <p
          className="reading-feedback"
          data-failed={feedback.failed}
          role={feedback.failed ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
};
