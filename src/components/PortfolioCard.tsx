import Image from "next/image";
import Link from "next/link";
import type { PortfolioProject } from "@/lib/portfolio";

/** Selo no canto da imagem: diz se é captura de tela ou diagrama. */
export function ProjectTag({ project }: { project: PortfolioProject }) {
  return (
    <span className="label pointer-events-none absolute left-3 top-3 bg-background/90 px-2 py-1 text-foreground-muted">
      {project.screenshot ? "Captura real" : "Arquitetura"}
    </span>
  );
}

/**
 * Imagem do projeto com a moldura da marca e zoom lento no hover.
 * `tag={false}` quando a imagem vai dentro de um link com aria-label: aí o
 * selo vai do lado de fora (ver /portfolio), porque texto visível dentro do
 * link tem que estar no nome dele (WCAG 2.5.3).
 */
export function ProjectImage({
  project,
  priority = false,
  sizes,
  tag = true,
}: {
  project: PortfolioProject;
  priority?: boolean;
  sizes: string;
  tag?: boolean;
}) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden border border-border-faint bg-background">
      <Image
        src={project.image}
        alt={project.imageAlt}
        fill
        priority={priority}
        sizes={sizes}
        className="object-cover object-top transition-transform duration-700 ease-out group-hover:scale-[1.03]"
      />
      {tag ? <ProjectTag project={project} /> : null}
    </div>
  );
}

export function StackTags({ stack }: { stack: string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {stack.map((tech) => (
        <li key={tech} className="dys-label dys-label--notice">
          {tech}
        </li>
      ))}
    </ul>
  );
}

/** Card compacto (home e grade do portfólio). */
export function PortfolioCard({ project }: { project: PortfolioProject }) {
  return (
    <article className="sweep group flex h-full flex-col gap-5 bg-background p-5 transition-colors hover:bg-background-elevated sm:p-6">
      <Link href={`/portfolio#${project.slug}`} className="flex flex-col gap-5">
        <ProjectImage project={project} sizes="(min-width: 1024px) 40vw, 90vw" />
        <div className="flex items-center justify-between gap-4">
          <span className="serial text-signal-text">{project.code}</span>
          <span className="label text-foreground-muted">{project.year}</span>
        </div>
        <div>
          <h3 className="display-3 text-[18px] leading-[26px] tracking-[0.1em]">{project.name}</h3>
          <p className="label mt-2 text-foreground-muted">{project.kind}</p>
        </div>
        <p className="text-sm leading-relaxed text-foreground-muted">{project.summary}</p>
      </Link>
      <div className="mt-auto">
        <StackTags stack={project.stack.slice(0, 4)} />
      </div>
    </article>
  );
}
