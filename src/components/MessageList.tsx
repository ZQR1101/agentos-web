import MessageBubble from "./MessageBubble";

import type { Message } from "@/types/chat";

interface Props {
  messages: Message[];
}


export default function MessageList({
  messages
}: Props) {


  return (
    <div
    className="
    fles-1
    overflow-y-auto
    space-y-2
    "
    >

      {
        messages.map((message,index)=>(
          
          <MessageBubble
            key={index}
            role={message.role}
            content={message.content}
          />

        ))
      }

    </div>
  );
}
