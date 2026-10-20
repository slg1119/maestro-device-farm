import { Navigate, createBrowserRouter, type RouteObject } from "react-router";

import { Layout } from "./components/Layout";
import { AppsPage } from "./pages/apps/AppsPage";
import { DevicesPage } from "./pages/devices/DevicesPage";
import { NewRunPage } from "./pages/new-run/NewRunPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RunDetailPage } from "./pages/run-detail/RunDetailPage";
import { RunsPage } from "./pages/runs/RunsPage";
import { WorkspacesPage } from "./pages/workspaces/WorkspacesPage";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/devices" replace /> },
      { path: "devices", element: <DevicesPage /> },
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
