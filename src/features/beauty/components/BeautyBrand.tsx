type BeautyBrandMarkProps = {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

const beautySymbol = '/branding/ui-symbol-transparent-256.png?v=20260729b';

export function BeautyBrandMark({ className = '', size = 'md' }: BeautyBrandMarkProps) {
  return (
    <span className={`beauty-brand-mark beauty-brand-mark--${size} ${className}`.trim()}>
      <img alt="" aria-hidden="true" height="192" src={beautySymbol} width="192" />
    </span>
  );
}

export function BeautyBrandLockup() {
  return (
    <div className="beauty-brand-lockup" aria-label="COSTABOTS Beauty">
      <BeautyBrandMark />
      <span><strong>COSTABOTS</strong><small>BEAUTY</small></span>
    </div>
  );
}
