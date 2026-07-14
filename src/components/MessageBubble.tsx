import { MessageRole } from "@/types/chat";


interface Props {
  role: MessageRole;
  content: string;
}


export default function MessageBubble({
  role,
  content
}: Props) {


  const isUser = role === "user";


  return (
    <div
      className={
        `
        flex
        ${isUser ? "justify-end" : "justify-start"}
        my-2
        `
      }
    >

      <div
        className={
          `
          max-w-md
          rounded-lg
          px-4
          py-2
          ${
            isUser
            ? "bg-blue-500 text-white"
            : "bg-gray-200 text-black"
          }
          `
        }
      >

        <div className="text-sm font-bold">
          {role}
        </div>


        <div>
          {content}
        </div>


      </div>

    </div>
  );
}
