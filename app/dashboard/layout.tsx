import { UserButton } from "@clerk/nextjs";
import AppHeader, { AppSidebar } from "./AppHeader";
import { ChatProvider } from "./ChatContext";

// Every signed-in page shares the same navigation: a sidebar on desktop,
// a top bar on smaller screens.
//
// The assistant's state (ChatProvider) lives here, above every page, so
// a conversation survives opening the brief, switching to Email or
// Calendar, or popping into Settings and back.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = (
    <UserButton
      appearance={{ elements: { userButtonAvatarBox: "h-9 w-9" } }}
    />
  );

  return (
    <div className="flex min-h-screen">
      <AppSidebar account={account} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader account={account} />
        <ChatProvider>
          <div className="flex flex-1 flex-col">{children}</div>
        </ChatProvider>
      </div>
    </div>
  );
}
