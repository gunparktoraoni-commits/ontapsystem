  // components/analytics/RecentActivity.tsx
  "use client";

  import { RecentActivity as RecentActivityType } from "@/types/analytics";
  import { 
    Eye, 
    Bookmark, 
    MapPin, 
    Smartphone, 
    Monitor, 
    Clock, 
    ChevronRight, 
    ChevronLeft 
  } from "lucide-react";
  import { motion, AnimatePresence } from "framer-motion";
  import { cn } from "@/lib/utils";

  interface RecentActivityProps {
    activities: RecentActivityType[];
    pagination: {
      page: number;
      pages: number;
      total: number;
      limit: number;
    };

    onPageChange: (page: number) => void;
    // Optional filters or actions if needed
    onFilterChange?: (type: 'all' | 'profile_view' | 'contact_save') => void;
    currentFilter?: string;
  }


  const ActivityIcon = ({ type }: { type: "profile_view" | "contact_save" }) => {


    if (type === "profile_view") {
      return (
        <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0 z-10 relative">
          <Eye className="w-4 h-4 text-blue-600" />
          <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />
        </div>
      );
    }


    return (
      <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0 z-10 relative">
        <Bookmark className="w-4 h-4 text-emerald-600" />
        <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" />
      </div>
    );
  };



  export function RecentActivity({ activities, pagination, onPageChange, currentFilter, onFilterChange }: RecentActivityProps) {



    const container = {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: {
          staggerChildren: 0.05
        }
      }
    };


    const itemVariant = {
      hidden: { x: -10, opacity: 0 },
      show: { x: 0, opacity: 1 }
    };


    return (  
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full min-h-125">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Recent Activity</h2>
            <p className="text-sm text-gray-500 mt-1">Live feed of visitor interactions</p>
          </div>
          {onFilterChange && (
            <div className="flex bg-white rounded-lg border border-gray-200 p-1">
              <button 
                  onClick={() => onFilterChange('all')}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", (!currentFilter || currentFilter === 'all') ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-50")}
              >
                  All
              </button>
              <button 
                  onClick={() => onFilterChange('profile_view')}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", currentFilter === 'profile_view' ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:bg-gray-50")}
              >

                  Views 

              </button>

              <button 
                  onClick={() => onFilterChange('contact_save')}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", currentFilter === 'contact_save' ? "bg-emerald-50 text-emerald-700" : "text-gray-500 hover:bg-gray-50")}
              >

                  Saves

              </button>
            </div>
          )}


        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 relative">
          {/* Timeline line */}
          <div className="absolute left-[39px] top-6 bottom-6 w-px bg-gradient-to-b from-gray-200 via-gray-200 to-transparent" />

          {activities.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center text-gray-400">
              <Clock className="w-10 h-10 mb-3 opacity-20" />
              <p>No activity yet.</p>
            </div>
          ) : (

            <motion.div 
              variants={container}
              initial="hidden"
              animate="show"
              className="space-y-6"
            >


              <AnimatePresence mode="popLayout">
              {activities.map((activity) => (
                <motion.div 
                  key={activity.id} 
                  variants={itemVariant} 
                  layout 
                  className="group relative flex items-start gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100"
                >

                  <ActivityIcon type={activity.type} />



                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1 mb-1">
                      <p className="text-sm font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors line-clamp-2 pr-4">
                        {activity.description}
                      </p>


                      <span className="text-[10px] font-medium text-gray-400 whitespace-nowrap bg-gray-100 px-2 py-0.5 rounded-full self-start">
                        {activity.time_ago}
                      </span>

                    </div>
                    
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1.5 bg-white border border-gray-200 px-2 py-1 rounded-md shadow-sm">
                        <MapPin className="w-3 h-3 text-gray-400" />
                        <span className="truncate max-w-[120px]">{activity.location}</span>
                      </span>
                      <span className="flex items-center gap-1.5 bg-white border border-gray-200 px-2 py-1 rounded-md shadow-sm">
                        {activity.device.toLowerCase().includes('mobile') ? 
                          <Smartphone className="w-3 h-3 text-gray-400" /> : 
                          <Monitor className="w-3 h-3 text-gray-400" />
                        }
                        <span className="truncate max-w-[120px]">{activity.device}</span>
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}

              </AnimatePresence>
            </motion.div>
          )}

        </div>

        {pagination.pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between mt-auto">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <ChevronLeft className="w-3.5 h-3.5" />

              Prev

            </button>

            <span className="text-xs font-medium text-gray-500">
              Page <span className="text-gray-900 font-bold">{pagination.page}</span> of {pagination.pages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.pages}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      </div>

    );

  }