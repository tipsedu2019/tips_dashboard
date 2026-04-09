import React from "react";
import ReactDOM from "react-dom/client";

import "../index.css";
import "../styles/tds-foundation.css";
import "../styles/tds-components.css";
import "../styles/tds-utilities.css";
import "../styles/dashboard-shell.css";
import "../styles/tds-dashboard.css";
import "../styles/tds-public.css";

import PublicClassesApp from "./PublicClassesApp.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PublicClassesApp />
  </React.StrictMode>,
);

