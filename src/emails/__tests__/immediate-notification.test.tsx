import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { ImmediateNotification } from "../immediate-notification";

// Real-world shape: Linear comment bodies arrive as markdown, including
// Linear's angle-bracket link destinations like [text](<http://url>).
const markdownExcerpt = `Hi Caroline,

Here's the latest list of subscribers from the past two weeks.

* 11 new subscribers (24 May - 3 June)
* Covers sign-ups across [1896.co.za](<http://1896.co.za>) and [eighteen96.co.za](<http://eighteen96.co.za>)

[subs-2026-06-05.csv](https://uploads.linear.app/abc/def)

Thanks,
Sterna`;

function renderEmail(excerpt: string) {
  return render(
    <ImmediateNotification
      hubName="SLA - TFGJ"
      hubSlug="tfgj"
      event={{
        type: "comment",
        summary: "Comment updated on TFGJ3-201",
        entityType: "comment",
        entityId: "abc",
        actorName: "Sterna",
        metadata: { excerpt },
      }}
      deepLinkUrl="https://pulse.example.com/hub/tfgj"
    />
  );
}

describe("ImmediateNotification comment excerpt", () => {
  it("renders markdown links as anchors, including angle-bracket destinations", async () => {
    const html = await renderEmail(markdownExcerpt);
    expect(html).toContain('href="http://1896.co.za"');
    expect(html).toContain('href="https://uploads.linear.app/abc/def"');
    // No raw markdown syntax left behind
    expect(html).not.toContain("[1896.co.za](");
    expect(html).not.toContain("(<http://");
  });

  it("renders bullet lists as list items instead of inline asterisks", async () => {
    const html = await renderEmail(markdownExcerpt);
    expect(html).toContain("<li");
    expect(html).toContain("11 new subscribers (24 May - 3 June)");
    expect(html).not.toContain("* 11 new subscribers");
  });

  it("preserves paragraph breaks", async () => {
    const html = await renderEmail(markdownExcerpt);
    // Greeting and sign-off end up in separate paragraphs
    expect(html.match(/<p[ >]/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("still renders a plain-text excerpt unchanged", async () => {
    const html = await renderEmail("Just a simple comment.");
    expect(html).toContain("Just a simple comment.");
  });

  it("renders single newlines as hard line breaks, like Linear does", async () => {
    const html = await renderEmail("Thanks,\nSterna");
    expect(html).toMatch(/Thanks,<br\s*\/?>\s*Sterna/);
  });
});
