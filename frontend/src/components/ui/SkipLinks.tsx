import React from 'react';

export interface SkipLink {
  href: string;
  label: string;
}

export interface SkipLinksProps {
  links: SkipLink[];
  className?: string;
}

const SkipLinks: React.FC<SkipLinksProps> = ({
  links,
  className = ''
}) => {
  return (
    <div className={`sr-only ${className}`}>
      {links.map((link, index) => (
        <a
          key={index}
          href={link.href}
          className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50 transition-all duration-200"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
};

export default SkipLinks; 