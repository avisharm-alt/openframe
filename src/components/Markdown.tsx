import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * Safe Markdown for contributed text: raw HTML is dropped, images and iframes are never rendered
 * (no remote loads), links are limited to http(s) and are never fetched by the server.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore", throwOnError: false }]]}
        disallowedElements={["img", "iframe", "script", "style", "object", "embed", "form"]}
        components={{
          a({ href, children }) {
            if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
            return (
              <a href={href} rel="noopener noreferrer nofollow ugc" target="_blank">
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
