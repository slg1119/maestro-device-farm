import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";

import { Loading } from "./components/ui";
import { OverviewPage } from "./pages/overview/OverviewPage";
import { Layout } from "./components/Layout";
import { AppsPage } from "./pages/apps/AppsPage";
import { DevicesPage } from "./pages/devices/DevicesPage";
import { LiveBoardPage } from "./pages/live-board/LiveBoardPage";
import { NewRunPage } from "./pages/new-run/NewRunPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RunDetailPage } from "./pages/run-detail/RunDetailPage";
import { RunsPage } from "./pages/runs/RunsPage";
import { WorkspacesPage } from "./pages/workspaces/WorkspacesPage";

const EditorPage = lazy(() => import("./editor/EditorPage").then((module) => ({ default: module.EditorPage })));
const editor = <Suspense fallback={<Loading />}><EditorPage /></Suspense>;

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "editor", element: editor },
      { path: "editor/:workspace", element: editor },
      { path: "devices", element: <DevicesPage /> },
      { path: "live", element: <LiveBoardPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "runs/new", element: <NewRunPage /> },
      { path: "runs/:runId", element: <RunDetailPage /> },
      { path: "apps", element: <AppsPage /> },
      { path: "workspaces", element: <WorkspacesPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
