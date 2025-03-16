import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Check, X, ChevronDown } from "lucide-react";
import type { CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";
import type { SamplingRequest } from "@/lib/types/sampling";
import type { SamplingMessage } from "@modelcontextprotocol/sdk/types.js";

export type SamplingRequestMessageProps = {
  id: number;
  request: SamplingRequest;
  status: 'pending' | 'approved' | 'rejected';
  onApprove: (id: number, result: CreateMessageResult) => void;
  onReject: (id: number) => void;
};

const formatPriority = (value: number | undefined): string => {
  if (value === undefined) return 'Not specified';
  if (value >= 0.8) return 'High';
  if (value >= 0.4) return 'Medium';
  return 'Low';
};

const SamplingRequestMessage = ({ 
  id, 
  request, 
  status,
  onApprove, 
  onReject 
}: SamplingRequestMessageProps) => {
  const [isOpen, setIsOpen] = useState(status === 'pending');

  const handleApprove = () => {
    // For now, just return a stub response like in the original SamplingTab
    onApprove(id, {
      model: "stub-model",
      stopReason: "endTurn",
      role: "assistant",
      content: {
        type: "text",
        text: "This is a stub response.",
      },
    });
    setIsOpen(false);
  };

  const handleReject = () => {
    onReject(id);
    setIsOpen(false);
  };

  const statusIcon = status === 'approved' ? (
    <Check className="h-4 w-4 text-green-500" />
  ) : status === 'rejected' ? (
    <X className="h-4 w-4 text-red-500" />
  ) : null;

  return (
    <div className="rounded-lg bg-card border border-border">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Sampling Request</span>
            {statusIcon}
          </div>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="p-4 space-y-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Model Preferences</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
              Intelligence: {formatPriority(request.params.modelPreferences?.intelligencePriority)}
              </div>
              <div>
                Speed: {formatPriority(request.params.modelPreferences?.speedPriority)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Messages</h4>
            <div className="space-y-2">
              {request.params.messages.map((msg: SamplingMessage, index: number) => (
                <div 
                  key={index}
                  className={`p-2 rounded ${
                    msg.role === 'user' ? 'bg-primary/10' : 'bg-secondary/10'
                  }`}
                >
                  <div className="text-xs text-gray-500 mb-1">
                    {msg.role === 'user' ? 'User' : 'Assistant'}
                  </div>
                  {msg.content.type === 'text' && (
                    <div className="whitespace-pre-wrap text-sm">
                      {msg.content.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {status === 'pending' && (
            <div className="flex gap-2">
              <Button onClick={handleApprove}>
                Approve
              </Button>
              <Button variant="outline" onClick={handleReject}>
                Reject
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default SamplingRequestMessage;
