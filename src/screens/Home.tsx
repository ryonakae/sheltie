import Plus from '@gravity-ui/icons/Plus';
import { motion } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';

import { ProjectCard } from '@/components/Home/ProjectCard';
import { useProjectStore } from '@/store/tab-store';

export function HomeScreen() {
  const { projects, createProject, openProject } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      createProject: s.createProject,
      openProject: s.openProject,
    })),
  );
  const sortedProjects = [...projects]
    .filter((project) => Boolean(project.filePath))
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="mb-4 text-lg font-semibold text-foreground">最近開いたプロジェクト</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sortedProjects.map((project) => (
          <ProjectCard key={project.id} project={project} onOpen={() => openProject(project.id)} />
        ))}

        {/* 新規プロジェクト追加カード */}
        <motion.button
          className="flex min-h-[120px] cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-border-secondary text-muted hover:border-border-tertiary hover:text-foreground"
          onClick={() => createProject()}
          aria-label="新規プロジェクトを追加"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.15 }}
        >
          <Plus className="size-6" />
        </motion.button>
      </div>

      {sortedProjects.length === 0 && (
        <p className="mt-8 text-center text-sm text-muted">
          保存済みのプロジェクトはまだありません
        </p>
      )}
    </div>
  );
}
