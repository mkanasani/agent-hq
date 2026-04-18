import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import Office from "@/pages/Office";
import Tasks from "@/pages/Tasks";
import Activity from "@/pages/Activity";
import Agents from "@/pages/Agents";
import Forms from "@/pages/Forms";
import FormSubmissions from "@/pages/FormSubmissions";
import Webhooks from "@/pages/Webhooks";
import Integrations from "@/pages/Integrations";
import PublicForm from "@/pages/PublicForm";

export default function App() {
  return (
    <>
      <div className="app-bg" />
      <div className="grid-bg" />

      <Routes>
        <Route path="/form/:slug" element={<PublicForm />} />
        <Route path="/*" element={<Shell />} />
      </Routes>
    </>
  );
}

function Shell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 px-10 py-8 max-w-[1600px] mx-auto w-full">
        <Routes>
          <Route path="/" element={<Office />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/:slug" element={<FormSubmissions />} />
          <Route path="/webhooks" element={<Webhooks />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
