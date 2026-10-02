import { CheckIcon } from "./Icons";

/**
 * Decorative product illustration for the home page: a question card drawn with placeholder bars only
 * (no real or invented question text). Hidden from assistive technology.
 */
export function HeroVisual() {
  return (
    <div className="hero-visual" aria-hidden="true">
      <div className="mock mock-main">
        <div className="mock-top">
          <span className="mock-chip" />
          <span className="mock-chip ok" />
        </div>
        <span className="mock-line strong w85" />
        <span className="mock-line w60" />
        <div className="mock-opt"><i className="mock-radio" /><span className="mock-line w55" /></div>
        <div className="mock-opt ok"><i className="mock-radio on" /><span className="mock-line w40" /><CheckIcon size={16} className="mock-tick" /></div>
        <div className="mock-opt"><i className="mock-radio" /><span className="mock-line w65" /></div>
        <div className="mock-progress"><span /></div>
      </div>
      <div className="mock mock-float">
        <span className="mock-badge"><CheckIcon size={16} /></span>
        <span className="mock-stack"><span className="mock-line strong w85" /><span className="mock-line w60" /></span>
      </div>
    </div>
  );
}
